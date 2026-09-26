// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {BattleBetting, IUniversalResolver} from "../src/BattleBetting.sol";
import {PinnedEns} from "./PinnedEns.sol";

/// Deploys BattleBetting to the chain behind --rpc-url. Every setting comes from .env; the
/// deployer becomes admin.
contract DeployBattleBetting is Script {
    function run() external returns (BattleBetting betting) {
        uint256 deployerKey = vm.envUint(_required("PRIVATE_KEY"));
        address operator = vm.envAddress(_required("OPERATOR_ADDRESS"));
        address treasury = vm.envAddress(_required("TREASURY_ADDRESS"));
        uint16 feeBps = SafeCast.toUint16(vm.envUint(_required("BET_FEE_BPS")));
        uint256 minBet = vm.envUint(_required("MIN_BET_WEI"));
        string memory ensLabel = vm.envString(_required("ENS_LABEL"));
        IUniversalResolver resolver = IUniversalResolver(PinnedEns.addressOf("UniversalResolverV2"));
        address admin = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        betting = new BattleBetting(admin, operator, treasury, feeBps, minBet, resolver, ensLabel);
        vm.stopBroadcast();

        console.log("BattleBetting", address(betting));
        console.log("admin", admin);
        console.log("UniversalResolverV2", address(resolver));
    }

    /// Stops with the variable's name when it is missing or blank, instead of a parse error.
    function _required(string memory name) private view returns (string memory) {
        if (bytes(vm.trim(vm.envOr(name, string("")))).length == 0) {
            revert(string.concat(name, " is required. Set it in .env. See .env.example."));
        }
        return name;
    }
}
