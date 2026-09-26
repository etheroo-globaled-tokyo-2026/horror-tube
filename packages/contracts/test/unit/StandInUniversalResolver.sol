// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ITextResolver, IUniversalResolver} from "../../src/BattleBetting.sol";

/// Answers `text(node, "status")` from a per-node table. It rejects a DNS name that
/// doesn't hash to the node it is asked about, so a name-encoding bug fails unit tests.
contract StandInUniversalResolver is IUniversalResolver {
    error StandInLookupFailed(bytes32 node);

    mapping(bytes32 node => string status) public statusOf;
    mapping(bytes32 node => bool) public failsFor;
    mapping(bytes32 node => bool) public answersEmptyFor;

    function setStatus(bytes32 node, string calldata status) external {
        statusOf[node] = status;
    }

    function setFails(bytes32 node) external {
        failsFor[node] = true;
    }

    function setAnswersEmpty(bytes32 node) external {
        answersEmptyFor[node] = true;
    }

    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory, address) {
        require(bytes4(data[:4]) == ITextResolver.text.selector, "stand-in: only text()");
        (bytes32 node, string memory key) = abi.decode(data[4:], (bytes32, string));
        require(keccak256(bytes(key)) == keccak256("status"), "stand-in: only the status key");
        require(_namehash(name, 0) == node, "stand-in: name and node disagree");
        if (failsFor[node]) revert StandInLookupFailed(node);
        if (answersEmptyFor[node]) return ("", address(this));
        return (abi.encode(statusOf[node]), address(this));
    }

    function _namehash(bytes calldata name, uint256 offset) private pure returns (bytes32) {
        uint256 length = uint8(name[offset]);
        if (length == 0) return bytes32(0);
        bytes32 labelHash = keccak256(name[offset + 1:offset + 1 + length]);
        return keccak256(abi.encodePacked(_namehash(name, offset + 1 + length), labelHash));
    }
}
