// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {BattleBetting} from "../../src/BattleBetting.sol";
import {StandInUniversalResolver} from "./StandInUniversalResolver.sol";

contract BattleBettingTest is Test {
    uint16 internal constant FEE_BPS = 200;
    uint256 internal constant MIN_BET = 0.00001 ether;
    uint64 internal constant BETTING_WINDOW = 1 hours;

    StandInUniversalResolver internal ens;
    BattleBetting internal betting;

    address internal admin = makeAddr("admin");
    address internal operator = makeAddr("operator");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    function setUp() public {
        ens = new StandInUniversalResolver();
        betting = new BattleBetting(admin, operator, treasury, FEE_BPS, MIN_BET, ens, "horrortube");
    }

    function _open(string memory fighterA, string memory fighterB) internal returns (uint256) {
        vm.prank(operator);
        return betting.openBattle(fighterA, fighterB, uint64(block.timestamp) + BETTING_WINDOW);
    }

    function _open() internal returns (uint256) {
        return _open("jason", "freddy");
    }

    function _bet(address bettor, uint256 battleId, uint8 fighter, uint256 amount) internal {
        vm.deal(bettor, bettor.balance + amount);
        vm.prank(bettor);
        betting.placeBet{value: amount}(battleId, fighter);
    }

    function _kill(string memory fighter) internal {
        ens.setStatus(betting.fighterNode(fighter), "dead");
    }

    function _closeBetting(uint256 battleId) internal {
        vm.warp(betting.getBattle(battleId).closesAt);
    }

    function _settleWithLoser(uint256 battleId, string memory loser) internal {
        _closeBetting(battleId);
        _kill(loser);
        betting.settleBattle(battleId);
    }

    function _claim(address bettor, uint256 battleId) internal returns (uint256) {
        uint256 before = bettor.balance;
        vm.prank(bettor);
        betting.claim(battleId);
        return bettor.balance - before;
    }

    function _unauthorized(address account, bytes32 role) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, account, role);
    }

    function test_fighterNodeIsTheEnsNamehashOfTheSubname() public view {
        assertEq(betting.fighterNode("jason"), vm.ensNamehash("jason.horrortube.eth"));
    }

    function test_constructorRejectsBadConfig() public {
        vm.expectRevert(BattleBetting.ZeroAddress.selector);
        new BattleBetting(address(0), operator, treasury, FEE_BPS, MIN_BET, ens, "horrortube");
        vm.expectRevert(BattleBetting.ZeroAddress.selector);
        new BattleBetting(admin, operator, address(0), FEE_BPS, MIN_BET, ens, "horrortube");
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.FeeTooHigh.selector, 1001, 1000));
        new BattleBetting(admin, operator, treasury, 1001, MIN_BET, ens, "horrortube");
        vm.expectRevert(BattleBetting.ZeroMinBet.selector);
        new BattleBetting(admin, operator, treasury, FEE_BPS, 0, ens, "horrortube");
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.InvalidLabel.selector, "horrortube.eth"));
        new BattleBetting(admin, operator, treasury, FEE_BPS, MIN_BET, ens, "horrortube.eth");
    }

    function test_openBattleNumbersBattlesAndStoresThem() public {
        uint256 first = _open();
        uint256 second = _open("michael", "chucky");

        assertEq(first, 1);
        assertEq(second, 2);
        BattleBetting.Battle memory battle = betting.getBattle(first);
        assertEq(battle.fighters[0], "jason");
        assertEq(battle.fighters[1], "freddy");
        assertEq(battle.closesAt, block.timestamp + BETTING_WINDOW);
        assertEq(uint8(battle.status), uint8(BattleBetting.Status.Open));
    }

    function test_openBattleRejectsBadInput() public {
        uint64 closesAt = uint64(block.timestamp) + BETTING_WINDOW;
        bytes32 operatorRole = betting.OPERATOR_ROLE();

        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice, operatorRole));
        betting.openBattle("jason", "freddy", closesAt);

        vm.startPrank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(BattleBetting.ClosesAtNotInFuture.selector, uint64(block.timestamp), block.timestamp)
        );
        betting.openBattle("jason", "freddy", uint64(block.timestamp));

        vm.expectRevert(abi.encodeWithSelector(BattleBetting.SameFighters.selector, "jason"));
        betting.openBattle("jason", "jason", closesAt);

        bytes memory tooLong = new bytes(64);
        for (uint256 i; i < tooLong.length; ++i) {
            tooLong[i] = "a";
        }
        string[] memory badLabels = new string[](5);
        badLabels[0] = "";
        badLabels[1] = "Jason";
        badLabels[2] = "jason.horrortube";
        badLabels[3] = "jason_voorhees";
        badLabels[4] = string(tooLong);
        for (uint256 i; i < badLabels.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(BattleBetting.InvalidLabel.selector, badLabels[i]));
            betting.openBattle(badLabels[i], "freddy", closesAt);
        }
        vm.stopPrank();
    }

    function test_openBattleRefusesADeadOrUnreadableFighter() public {
        uint64 closesAt = uint64(block.timestamp) + BETTING_WINDOW;
        _kill("freddy");
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.FighterAlreadyDead.selector, "freddy"));
        betting.openBattle("jason", "freddy", closesAt);

        bytes32 michael = betting.fighterNode("michael");
        ens.setFails(michael);
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                BattleBetting.EnsLookupFailed.selector,
                1,
                "michael",
                abi.encodeWithSelector(StandInUniversalResolver.StandInLookupFailed.selector, michael)
            )
        );
        betting.openBattle("jason", "michael", closesAt);
    }

    function test_fighterCanOnlyBeInOneUnsettledBattle() public {
        uint256 first = _open();
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.FighterInOpenBattle.selector, "jason", first));
        betting.openBattle("michael", "jason", uint64(block.timestamp) + BETTING_WINDOW);

        vm.prank(operator);
        betting.cancelBattle(first);
        uint256 second = _open("michael", "jason");
        assertEq(betting.openBattleOf(betting.fighterNode("jason")), second);

        _settleWithLoser(second, "michael");
        assertEq(betting.openBattleOf(betting.fighterNode("jason")), 0);
        _open("jason", "chucky");
    }

    function test_placeBetAddsUpStakesPerFighter() public {
        uint256 id = _open();
        _bet(alice, id, 0, 0.01 ether);
        _bet(alice, id, 0, 0.02 ether);
        _bet(alice, id, 1, 0.005 ether);

        vm.expectEmit(address(betting));
        emit BattleBetting.BetPlaced(id, bob, 1, 0.04 ether);
        _bet(bob, id, 1, 0.04 ether);

        uint256[2] memory aliceStakes = betting.stakesOf(id, alice);
        assertEq(aliceStakes[0], 0.03 ether);
        assertEq(aliceStakes[1], 0.005 ether);
        uint256[2] memory totals = betting.getBattle(id).totals;
        assertEq(totals[0], 0.03 ether);
        assertEq(totals[1], 0.045 ether);
    }

    function test_placeBetRejectsInvalidBets() public {
        uint256 id = _open();
        uint256 cancelled = _open("michael", "chucky");
        vm.prank(operator);
        betting.cancelBattle(cancelled);
        uint64 closesAt = betting.getBattle(id).closesAt;

        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.BetBelowMinimum.selector, MIN_BET - 1, MIN_BET));
        betting.placeBet{value: MIN_BET - 1}(id, 0);

        vm.expectRevert(abi.encodeWithSelector(BattleBetting.InvalidFighter.selector, 2));
        betting.placeBet{value: MIN_BET}(id, 2);

        vm.expectRevert(abi.encodeWithSelector(BattleBetting.BattleNotOpen.selector, 99, BattleBetting.Status.None));
        betting.placeBet{value: MIN_BET}(99, 0);

        vm.expectRevert(
            abi.encodeWithSelector(BattleBetting.BattleNotOpen.selector, cancelled, BattleBetting.Status.Cancelled)
        );
        betting.placeBet{value: MIN_BET}(cancelled, 0);

        vm.warp(closesAt);
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.BettingClosed.selector, id, closesAt));
        betting.placeBet{value: MIN_BET}(id, 0);
        vm.stopPrank();
    }

    function test_operatorCanEndBettingBeforeClosesAt() public {
        uint256 id = _open();
        _bet(alice, id, 0, 0.01 ether);
        bytes32 operatorRole = betting.OPERATOR_ROLE();
        vm.prank(alice);
        vm.expectRevert(_unauthorized(alice, operatorRole));
        betting.closeBetting(id);

        vm.prank(operator);
        betting.closeBetting(id);

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.BettingClosed.selector, id, uint64(block.timestamp)));
        betting.placeBet{value: MIN_BET}(id, 1);

        _kill("freddy");
        betting.settleBattle(id);
        assertEq(uint8(betting.getBattle(id).status), uint8(BattleBetting.Status.Settled));
    }

    function test_settleWaitsForCloseAndExactlyOneDeadFighter() public {
        uint256 id = _open();
        uint64 closesAt = betting.getBattle(id).closesAt;
        _kill("freddy");

        vm.expectRevert(abi.encodeWithSelector(BattleBetting.BettingStillOpen.selector, id, closesAt));
        betting.settleBattle(id);

        vm.warp(closesAt);
        ens.setStatus(betting.fighterNode("freddy"), "");
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.NoFighterDead.selector, id));
        betting.settleBattle(id);

        _kill("jason");
        _kill("freddy");
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.BothFightersDead.selector, id));
        betting.settleBattle(id);
    }

    function test_settleNamesTheFighterWhoseEnsLookupFailed() public {
        uint256 id = _open();
        _closeBetting(id);
        bytes32 freddy = betting.fighterNode("freddy");
        ens.setFails(freddy);

        vm.expectRevert(
            abi.encodeWithSelector(
                BattleBetting.EnsLookupFailed.selector,
                id,
                "freddy",
                abi.encodeWithSelector(StandInUniversalResolver.StandInLookupFailed.selector, freddy)
            )
        );
        betting.settleBattle(id);
    }

    function test_settleMakesTheLivingFighterTheWinner() public {
        uint256 first = _open();
        uint256 second = _open("michael", "chucky");
        _closeBetting(second);

        _kill("jason");
        vm.prank(carol);
        betting.settleBattle(first);
        assertEq(betting.getBattle(first).winner, 1);
        assertEq(uint8(betting.getBattle(first).status), uint8(BattleBetting.Status.Settled));

        _kill("chucky");
        betting.settleBattle(second);
        assertEq(betting.getBattle(second).winner, 0);

        vm.expectRevert(
            abi.encodeWithSelector(BattleBetting.BattleNotOpen.selector, first, BattleBetting.Status.Settled)
        );
        betting.settleBattle(first);
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(BattleBetting.BattleNotOpen.selector, first, BattleBetting.Status.Settled)
        );
        betting.cancelBattle(first);
    }

    function test_claimPaysWinnersTheirShareMinusTheFee() public {
        uint256 id = _open();
        _bet(alice, id, 0, 0.03 ether);
        _bet(bob, id, 0, 0.01 ether);
        _bet(carol, id, 1, 0.04 ether);
        _closeBetting(id);
        _kill("freddy");

        vm.expectEmit(address(betting));
        emit BattleBetting.BattleSettled(id, 0, 0.0008 ether);
        betting.settleBattle(id);

        assertEq(betting.accruedFees(), 0.0008 ether);
        assertEq(betting.claimable(id, alice), 0.0594 ether);
        assertEq(_claim(alice, id), 0.0594 ether);
        assertEq(_claim(bob, id), 0.0198 ether);
        assertEq(betting.claimable(id, alice), 0);

        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.NothingToClaim.selector, id, carol));
        betting.claim(id);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.AlreadyClaimed.selector, id, alice));
        betting.claim(id);
    }

    function test_cancelledBattleRefundsEveryStakeWithoutFee() public {
        uint256 id = _open();
        _bet(alice, id, 0, 0.03 ether);
        _bet(alice, id, 1, 0.01 ether);
        _bet(bob, id, 1, 0.02 ether);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.BattleNotFinished.selector, id, BattleBetting.Status.Open));
        betting.claim(id);

        vm.prank(operator);
        betting.cancelBattle(id);

        assertEq(_claim(alice, id), 0.04 ether);
        assertEq(_claim(bob, id), 0.02 ether);
        assertEq(betting.accruedFees(), 0);
    }

    function test_settledBattleRefundsWhenOneFighterHadNoBackers() public {
        uint256 onlyWinnerBacked = _open();
        _bet(alice, onlyWinnerBacked, 0, 0.03 ether);
        uint256 onlyLoserBacked = _open("michael", "chucky");
        _bet(bob, onlyLoserBacked, 1, 0.02 ether);

        _closeBetting(onlyLoserBacked);
        _kill("freddy");
        _kill("chucky");
        betting.settleBattle(onlyWinnerBacked);
        betting.settleBattle(onlyLoserBacked);

        assertEq(_claim(alice, onlyWinnerBacked), 0.03 ether);
        assertEq(_claim(bob, onlyLoserBacked), 0.02 ether);
        assertEq(betting.accruedFees(), 0);
    }

    function test_feeChangeAppliesOnlyToBattlesOpenedAfterIt() public {
        uint256 opened = _open();
        vm.prank(admin);
        betting.setFeeBps(1000);
        uint256 openedAfter = _open("michael", "chucky");
        _bet(alice, opened, 0, 0.01 ether);
        _bet(bob, opened, 1, 0.01 ether);
        _bet(alice, openedAfter, 0, 0.01 ether);
        _bet(bob, openedAfter, 1, 0.01 ether);

        _closeBetting(openedAfter);
        _kill("freddy");
        _kill("chucky");
        betting.settleBattle(opened);
        betting.settleBattle(openedAfter);

        assertEq(betting.accruedFees(), 0.0012 ether);
        assertEq(_claim(alice, opened), 0.0198 ether);
        assertEq(_claim(alice, openedAfter), 0.019 ether);
    }

    function test_onlyAdminChangesTreasurySettings() public {
        bytes32 adminRole = betting.DEFAULT_ADMIN_ROLE();
        address[2] memory outsiders = [operator, alice];
        for (uint256 i; i < outsiders.length; ++i) {
            address outsider = outsiders[i];
            vm.startPrank(outsider);
            vm.expectRevert(_unauthorized(outsider, adminRole));
            betting.setFeeBps(100);
            vm.expectRevert(_unauthorized(outsider, adminRole));
            betting.setTreasury(outsider);
            vm.expectRevert(_unauthorized(outsider, adminRole));
            betting.setMinBet(1);
            vm.expectRevert(_unauthorized(outsider, adminRole));
            betting.withdrawFees();
            vm.stopPrank();
        }

        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.FeeTooHigh.selector, 1001, 1000));
        betting.setFeeBps(1001);
        vm.expectRevert(BattleBetting.ZeroAddress.selector);
        betting.setTreasury(address(0));
        vm.expectRevert(BattleBetting.ZeroMinBet.selector);
        betting.setMinBet(0);
        betting.setMinBet(0.001 ether);
        vm.stopPrank();

        uint256 id = _open();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BattleBetting.BetBelowMinimum.selector, 0.0005 ether, 0.001 ether));
        betting.placeBet{value: 0.0005 ether}(id, 0);
    }

    function test_withdrawFeesPaysTheCurrentTreasury() public {
        uint256 id = _open();
        _bet(alice, id, 0, 0.03 ether);
        _bet(carol, id, 1, 0.04 ether);
        _settleWithLoser(id, "freddy");
        address newTreasury = makeAddr("newTreasury");

        vm.startPrank(admin);
        betting.setTreasury(newTreasury);
        betting.withdrawFees();
        vm.expectRevert(BattleBetting.NothingToWithdraw.selector);
        betting.withdrawFees();
        vm.stopPrank();

        assertEq(newTreasury.balance, 0.0008 ether);
        assertEq(treasury.balance, 0);
        assertEq(_claim(alice, id), 0.0692 ether);
    }

    function testFuzz_payoutsNeverExceedThePool(uint96[6] memory amounts, bool[6] memory backJason, bool jasonDies)
        public
    {
        uint256 id = _open();
        address[6] memory bettors;
        uint256 pool;
        for (uint256 i; i < bettors.length; ++i) {
            bettors[i] = makeAddr(string.concat("bettor", vm.toString(i)));
            uint256 amount = bound(amounts[i], MIN_BET, 100 ether);
            _bet(bettors[i], id, backJason[i] ? 0 : 1, amount);
            pool += amount;
        }
        _settleWithLoser(id, jasonDies ? "jason" : "freddy");

        uint256 paid;
        uint256 claimers;
        for (uint256 i; i < bettors.length; ++i) {
            if (betting.claimable(id, bettors[i]) == 0) continue;
            paid += _claim(bettors[i], id);
            ++claimers;
        }
        uint256 fee = betting.accruedFees();
        assertLe(paid + fee, pool);
        assertLe(pool - paid - fee, claimers, "rounding keeps at most 1 wei per claimer");
        assertEq(address(betting).balance, pool - paid);
    }
}
