// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";

/// Reads ENS contract addresses from the pinned Sepolia deployment table that the TypeScript
/// ENS scripts also read, so no ENS address is copied into Solidity.
library PinnedEns {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    string internal constant TABLE = "../ens/scripts/pin/sepolia-addresses.md";

    function addressOf(string memory name) internal view returns (address) {
        string[] memory rows = VM.split(VM.readFile(TABLE), "\n");
        string memory rowStart = string.concat("| ", name, " ");
        for (uint256 i; i < rows.length; ++i) {
            if (VM.indexOf(rows[i], rowStart) != 0) continue;
            string[] memory afterBracket = VM.split(rows[i], "[");
            return VM.parseAddress(VM.split(afterBracket[1], "]")[0]);
        }
        revert(string.concat(name, " is missing from ", TABLE));
    }
}
