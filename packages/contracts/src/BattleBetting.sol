// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// ENS Universal Resolver entry point (ENSIP-23).
interface IUniversalResolver {
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory result, address resolver);
}

interface ITextResolver {
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

/// @title BattleBetting
/// @notice Parimutuel bets on Horror Tube battles. A battle settles from ENS: the fighter whose
/// `status` text record on `<fighter>.<ensLabel>.eth` reads `dead` lost. Winners split the pool
/// after a fee taken from the losing side, so a winning bet never returns less than its stake.
contract BattleBetting is AccessControl, ReentrancyGuardTransient {
    /// `None` marks battle ids that were never opened.
    enum Status {
        None,
        Open,
        Settled,
        Cancelled
    }

    struct Battle {
        string[2] fighters;
        uint64 closesAt;
        uint16 feeBps;
        Status status;
        uint8 winner;
        uint256[2] totals;
    }

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    uint16 public constant MAX_FEE_BPS = 1_000;
    uint256 private constant BPS_DENOMINATOR = 10_000;
    bytes32 private constant DEAD = keccak256("dead");

    /// The pinned UniversalResolverV2, not ENS's upgradeable proxy, so an ENS upgrade can't
    /// change what an open battle reads.
    IUniversalResolver public immutable UNIVERSAL_RESOLVER;
    bytes32 public immutable PARENT_NODE;
    bytes private _parentDnsName;

    address public treasury;
    uint16 public feeBps;
    uint256 public minBet;
    /// Fees wait here until withdrawn, so a treasury that rejects ETH can't block settlement.
    uint256 public accruedFees;
    uint256 public nextBattleId = 1;

    mapping(uint256 battleId => Battle) private _battles;
    mapping(uint256 battleId => mapping(address bettor => uint256[2] stakes)) private _stakes;
    mapping(uint256 battleId => mapping(address bettor => bool)) public claimed;
    /// Settlement reads a fighter's current ENS status, which only describes one fight, so a
    /// fighter may be in one unsettled battle at a time.
    mapping(bytes32 fighterNode => uint256 battleId) public openBattleOf;

    event BattleOpened(uint256 indexed battleId, string fighterA, string fighterB, uint64 closesAt, uint16 feeBps);
    event BetPlaced(uint256 indexed battleId, address indexed bettor, uint8 fighter, uint256 amount);
    event BattleSettled(uint256 indexed battleId, uint8 winner, uint256 fee);
    event BattleCancelled(uint256 indexed battleId);
    event BettingClosedEarly(uint256 indexed battleId, uint64 closesAt);
    event Claimed(uint256 indexed battleId, address indexed bettor, uint256 amount);
    event FeesWithdrawn(address indexed treasury, uint256 amount);
    event FeeBpsSet(uint16 feeBps);
    event TreasurySet(address treasury);
    event MinBetSet(uint256 minBet);

    error ZeroAddress();
    error FeeTooHigh(uint16 feeBps, uint16 maxFeeBps);
    error ZeroMinBet();
    error InvalidLabel(string label);
    error SameFighters(string fighter);
    error FighterAlreadyDead(string fighter);
    error FighterInOpenBattle(string fighter, uint256 battleId);
    error ClosesAtNotInFuture(uint64 closesAt, uint256 blockTimestamp);
    error BattleNotOpen(uint256 battleId, Status status);
    error BettingClosed(uint256 battleId, uint64 closesAt);
    error BettingStillOpen(uint256 battleId, uint64 closesAt);
    error InvalidFighter(uint8 fighter);
    error BetBelowMinimum(uint256 amount, uint256 minBet);
    error NoFighterDead(uint256 battleId);
    error BothFightersDead(uint256 battleId);
    error EnsLookupFailed(uint256 battleId, string fighter, bytes reason);
    error BattleNotFinished(uint256 battleId, Status status);
    error AlreadyClaimed(uint256 battleId, address bettor);
    error NothingToClaim(uint256 battleId, address bettor);
    error NothingToWithdraw();

    constructor(
        address admin,
        address operator,
        address treasury_,
        uint16 feeBps_,
        uint256 minBet_,
        IUniversalResolver universalResolver_,
        string memory ensLabel
    ) {
        if (admin == address(0) || operator == address(0) || address(universalResolver_) == address(0)) {
            revert ZeroAddress();
        }
        _requireLabel(ensLabel);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
        _setTreasury(treasury_);
        _setFeeBps(feeBps_);
        _setMinBet(minBet_);
        UNIVERSAL_RESOLVER = universalResolver_;
        bytes32 ethNode = keccak256(abi.encodePacked(bytes32(0), keccak256("eth")));
        PARENT_NODE = keccak256(abi.encodePacked(ethNode, keccak256(bytes(ensLabel))));
        _parentDnsName = abi.encodePacked(uint8(bytes(ensLabel).length), ensLabel, uint8(3), "eth", uint8(0));
    }

    function openBattle(string calldata fighterA, string calldata fighterB, uint64 closesAt)
        external
        onlyRole(OPERATOR_ROLE)
        returns (uint256 battleId)
    {
        _requireLabel(fighterA);
        _requireLabel(fighterB);
        if (keccak256(bytes(fighterA)) == keccak256(bytes(fighterB))) revert SameFighters(fighterA);
        if (closesAt <= block.timestamp) revert ClosesAtNotInFuture(closesAt, block.timestamp);

        battleId = nextBattleId++;
        _reserveFighter(battleId, fighterA);
        _reserveFighter(battleId, fighterB);
        Battle storage battle = _battles[battleId];
        battle.fighters[0] = fighterA;
        battle.fighters[1] = fighterB;
        battle.closesAt = closesAt;
        battle.feeBps = feeBps;
        battle.status = Status.Open;
        emit BattleOpened(battleId, fighterA, fighterB, closesAt, feeBps);
    }

    function placeBet(uint256 battleId, uint8 fighter) external payable {
        Battle storage battle = _requireOpen(battleId);
        if (block.timestamp >= battle.closesAt) revert BettingClosed(battleId, battle.closesAt);
        if (fighter > 1) revert InvalidFighter(fighter);
        if (msg.value < minBet) revert BetBelowMinimum(msg.value, minBet);

        _stakes[battleId][msg.sender][fighter] += msg.value;
        battle.totals[fighter] += msg.value;
        emit BetPlaced(battleId, msg.sender, fighter, msg.value);
    }

    function settleBattle(uint256 battleId) external {
        Battle storage battle = _requireOpen(battleId);
        if (block.timestamp < battle.closesAt) revert BettingStillOpen(battleId, battle.closesAt);
        bool firstDead = _isDead(battleId, battle.fighters[0]);
        bool secondDead = _isDead(battleId, battle.fighters[1]);
        if (firstDead && secondDead) revert BothFightersDead(battleId);
        if (!firstDead && !secondDead) revert NoFighterDead(battleId);

        uint8 winner = firstDead ? 1 : 0;
        uint256 winnerTotal = battle.totals[winner];
        uint256 loserTotal = battle.totals[1 - winner];
        uint256 fee = winnerTotal == 0 || loserTotal == 0 ? 0 : _fee(battle.feeBps, loserTotal);
        battle.status = Status.Settled;
        battle.winner = winner;
        accruedFees += fee;
        _releaseFighters(battle);
        emit BattleSettled(battleId, winner, fee);
    }

    /// The game ends betting when the fight video is ready, which isn't known at open, so
    /// `closesAt` is the latest close and the operator can end betting sooner.
    function closeBetting(uint256 battleId) external onlyRole(OPERATOR_ROLE) {
        Battle storage battle = _requireOpen(battleId);
        if (block.timestamp >= battle.closesAt) revert BettingClosed(battleId, battle.closesAt);
        battle.closesAt = uint64(block.timestamp);
        emit BettingClosedEarly(battleId, battle.closesAt);
    }

    function cancelBattle(uint256 battleId) external onlyRole(OPERATOR_ROLE) {
        Battle storage battle = _requireOpen(battleId);
        battle.status = Status.Cancelled;
        _releaseFighters(battle);
        emit BattleCancelled(battleId);
    }

    function claim(uint256 battleId) external nonReentrant {
        Status status = _battles[battleId].status;
        if (status != Status.Settled && status != Status.Cancelled) revert BattleNotFinished(battleId, status);
        if (claimed[battleId][msg.sender]) revert AlreadyClaimed(battleId, msg.sender);
        uint256 amount = _owed(battleId, msg.sender);
        if (amount == 0) revert NothingToClaim(battleId, msg.sender);

        claimed[battleId][msg.sender] = true;
        emit Claimed(battleId, msg.sender, amount);
        Address.sendValue(payable(msg.sender), amount);
    }

    function setFeeBps(uint16 newFeeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setFeeBps(newFeeBps);
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setTreasury(newTreasury);
    }

    function setMinBet(uint256 newMinBet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setMinBet(newMinBet);
    }

    function withdrawFees() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        uint256 amount = accruedFees;
        if (amount == 0) revert NothingToWithdraw();
        accruedFees = 0;
        emit FeesWithdrawn(treasury, amount);
        Address.sendValue(payable(treasury), amount);
    }

    function getBattle(uint256 battleId) external view returns (Battle memory) {
        return _battles[battleId];
    }

    function stakesOf(uint256 battleId, address bettor) external view returns (uint256[2] memory) {
        return _stakes[battleId][bettor];
    }

    /// Returns 0 until the battle is settled or cancelled, and after the bettor has claimed.
    function claimable(uint256 battleId, address bettor) external view returns (uint256) {
        Status status = _battles[battleId].status;
        if ((status != Status.Settled && status != Status.Cancelled) || claimed[battleId][bettor]) return 0;
        return _owed(battleId, bettor);
    }

    function fighterNode(string memory fighter) public view returns (bytes32) {
        return keccak256(abi.encodePacked(PARENT_NODE, keccak256(bytes(fighter))));
    }

    function _owed(uint256 battleId, address bettor) private view returns (uint256) {
        Battle storage battle = _battles[battleId];
        uint256[2] storage stakes = _stakes[battleId][bettor];
        uint8 winner = battle.winner;
        uint256 winnerTotal = battle.totals[winner];
        uint256 loserTotal = battle.totals[1 - winner];
        if (battle.status == Status.Cancelled || winnerTotal == 0 || loserTotal == 0) {
            return stakes[0] + stakes[1];
        }
        return stakes[winner] * (winnerTotal + loserTotal - _fee(battle.feeBps, loserTotal)) / winnerTotal;
    }

    function _fee(uint16 bps, uint256 loserTotal) private pure returns (uint256) {
        return loserTotal * bps / BPS_DENOMINATOR;
    }

    /// Builds the DNS name and the node from the same label, so the two can't disagree.
    function _isDead(uint256 battleId, string memory fighter) private view returns (bool) {
        bytes memory name = abi.encodePacked(uint8(bytes(fighter).length), fighter, _parentDnsName);
        bytes memory textCall = abi.encodeCall(ITextResolver.text, (fighterNode(fighter), "status"));
        try UNIVERSAL_RESOLVER.resolve(name, textCall) returns (bytes memory result, address) {
            return keccak256(bytes(abi.decode(result, (string)))) == DEAD;
        } catch (bytes memory reason) {
            revert EnsLookupFailed(battleId, fighter, reason);
        }
    }

    /// A fighter who already reads `dead` would hand the other side a known win.
    function _reserveFighter(uint256 battleId, string calldata fighter) private {
        bytes32 node = fighterNode(fighter);
        uint256 current = openBattleOf[node];
        if (current != 0) revert FighterInOpenBattle(fighter, current);
        if (_isDead(battleId, fighter)) revert FighterAlreadyDead(fighter);
        openBattleOf[node] = battleId;
    }

    function _releaseFighters(Battle storage battle) private {
        delete openBattleOf[fighterNode(battle.fighters[0])];
        delete openBattleOf[fighterNode(battle.fighters[1])];
    }

    function _requireOpen(uint256 battleId) private view returns (Battle storage battle) {
        battle = _battles[battleId];
        if (battle.status != Status.Open) revert BattleNotOpen(battleId, battle.status);
    }

    /// Only a-z, 0-9 and '-' up to 63 bytes: anything else can't form the ENS name settlement reads.
    function _requireLabel(string memory label) private pure {
        bytes memory raw = bytes(label);
        if (raw.length == 0 || raw.length > 63) revert InvalidLabel(label);
        for (uint256 i; i < raw.length; ++i) {
            bytes1 c = raw[i];
            if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-")) revert InvalidLabel(label);
        }
    }

    function _setFeeBps(uint16 newFeeBps) private {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        feeBps = newFeeBps;
        emit FeeBpsSet(newFeeBps);
    }

    function _setTreasury(address newTreasury) private {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasurySet(newTreasury);
    }

    function _setMinBet(uint256 newMinBet) private {
        if (newMinBet == 0) revert ZeroMinBet();
        minBet = newMinBet;
        emit MinBetSet(newMinBet);
    }
}
