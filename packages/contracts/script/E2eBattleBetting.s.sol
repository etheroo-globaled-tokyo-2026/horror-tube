// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {BattleBetting} from "../src/BattleBetting.sol";
import {PinnedEns} from "./PinnedEns.sol";

/// Runs real transactions from the PRIVATE_KEY wallet against the deployment at
/// BATTLE_BETTING_ADDRESS: checks which ENS name and resolver it reads, then opens a throwaway
/// `e2e-a` vs `e2e-b` battle, bets on both fighters, cancels it and claims the refund.
/// Settling needs a live ENS status change, so the Sepolia fork test covers that path.
contract E2eBattleBetting is Script {
    function run() external {
        BattleBetting betting = BattleBetting(vm.envAddress(_required("BATTLE_BETTING_ADDRESS")));
        uint256 key = vm.envUint(_required("PRIVATE_KEY"));
        string memory ensLabel = vm.envString(_required("ENS_LABEL"));
        address wallet = vm.addr(key);

        require(
            address(betting.UNIVERSAL_RESOLVER()) == PinnedEns.addressOf("UniversalResolverV2"),
            "UNIVERSAL_RESOLVER is not the pinned UniversalResolverV2"
        );
        require(
            betting.PARENT_NODE() == vm.ensNamehash(string.concat(ensLabel, ".eth")),
            "PARENT_NODE is not the namehash of <ENS_LABEL>.eth"
        );
        require(betting.hasRole(betting.OPERATOR_ROLE(), wallet), "the PRIVATE_KEY wallet lacks OPERATOR_ROLE");
        uint256 minBet = betting.minBet();
        console.log("treasury", betting.treasury());
        console.log("feeBps", betting.feeBps());
        console.log("minBet", minBet);

        vm.startBroadcast(key);
        uint256 battleId = betting.openBattle("e2e-a", "e2e-b", uint64(block.timestamp + 1 hours));
        betting.placeBet{value: minBet}(battleId, 0);
        betting.placeBet{value: 2 * minBet}(battleId, 1);
        betting.cancelBattle(battleId);
        uint256 owed = betting.claimable(battleId, wallet);
        uint256 heldBeforeClaim = address(betting).balance;
        betting.claim(battleId);
        vm.stopBroadcast();

        require(owed == 3 * minBet, "claimable is not the sum of both stakes");
        require(heldBeforeClaim - address(betting).balance == owed, "claim did not pay out the refund");
        require(betting.claimed(battleId, wallet), "claim was not recorded");
        console.log("battle opened, bet on, cancelled and refunded:", battleId);
    }

    /// Stops with the variable's name when it is missing or blank, instead of a parse error.
    function _required(string memory name) private view returns (string memory) {
        if (bytes(vm.trim(vm.envOr(name, string("")))).length == 0) {
            revert(string.concat(name, " is required. Set it in .env. See .env.example."));
        }
        return name;
    }
}
