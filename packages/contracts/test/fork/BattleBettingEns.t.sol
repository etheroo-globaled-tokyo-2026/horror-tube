// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BattleBetting, ITextResolver, IUniversalResolver} from "../../src/BattleBetting.sol";
import {PinnedEns} from "../../script/PinnedEns.sol";

interface IETHRegistry {
    function findOwner(string calldata label) external view returns (address);
}

interface IPermissionedResolverTextSetter {
    function setText(bytes calldata name, string calldata key, string calldata value) external;
}

/// Settles against the real ENSv2 contracts on a Sepolia fork. The parent name's owner marks a
/// fighter dead on the resolver ENS itself returns for that fighter, as the backend will.
contract BattleBettingEnsForkTest is Test {
    function test_settlesFromTheStatusRecordOnSepoliaEns() public {
        vm.createSelectFork(vm.rpcUrl("sepolia"));
        string memory label = vm.envString("ENS_LABEL");
        IUniversalResolver universalResolver = IUniversalResolver(PinnedEns.addressOf("UniversalResolverV2"));
        address nameOwner = IETHRegistry(PinnedEns.addressOf("ETHRegistry")).findOwner(label);

        BattleBetting betting = new BattleBetting(
            address(this), address(this), makeAddr("treasury"), 200, 0.00001 ether, universalResolver, label
        );
        uint256 id = betting.openBattle("jason", "freddy", uint64(block.timestamp + 1 hours));
        address jasonFan = makeAddr("jasonFan");
        address freddyFan = makeAddr("freddyFan");
        vm.deal(jasonFan, 1 ether);
        vm.deal(freddyFan, 1 ether);
        vm.prank(jasonFan);
        betting.placeBet{value: 0.03 ether}(id, 0);
        vm.prank(freddyFan);
        betting.placeBet{value: 0.01 ether}(id, 1);
        vm.warp(block.timestamp + 1 hours);

        vm.expectRevert(abi.encodeWithSelector(BattleBetting.NoFighterDead.selector, id));
        betting.settleBattle(id);

        bytes memory freddyName =
            abi.encodePacked(uint8(6), "freddy", uint8(bytes(label).length), label, uint8(3), "eth", uint8(0));
        (, address resolver) = universalResolver.resolve(
            freddyName, abi.encodeCall(ITextResolver.text, (betting.fighterNode("freddy"), "status"))
        );
        vm.prank(nameOwner);
        IPermissionedResolverTextSetter(resolver).setText(freddyName, "status", "dead");

        betting.settleBattle(id);
        assertEq(betting.getBattle(id).winner, 0);

        uint256 before = jasonFan.balance;
        vm.prank(jasonFan);
        betting.claim(id);
        assertEq(jasonFan.balance - before, 0.0398 ether);
        vm.prank(freddyFan);
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.NothingToClaim.selector, id, freddyFan));
        betting.claim(id);
    }
}
