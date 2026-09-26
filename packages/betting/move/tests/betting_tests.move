#[test_only]
module horror_tube::betting_tests;

use horror_tube::betting::{Self, AdminCap, OperatorCap, House, Pool, Ticket};
use std::unit_test::{assert_eq, destroy};
use sui::clock::{Self, Clock};
use sui::coin;
use sui::test_scenario::{Self as ts, Scenario};

public struct TEST_USDC has drop {}

public struct OTHER_COIN has drop {}

const ADMIN: address = @0xAD;
const OPERATOR: address = @0x0B;
const SPONSOR: address = @0x5B;
const ALICE: address = @0xA1;
const BOB: address = @0xB0;
const CAROL: address = @0xC0;

const FEE_BPS: u64 = 200;
const MIN_BET: u64 = 30_000;
const WINDOW: u64 = 1_000_000;

fun setup(): (Scenario, Clock) {
    let mut scenario = ts::begin(ADMIN);
    betting::init_for_testing(scenario.ctx());
    scenario.next_tx(ADMIN);
    let admin = scenario.take_from_sender<AdminCap>();
    betting::create_house<TEST_USDC>(&admin, FEE_BPS, MIN_BET, SPONSOR, scenario.ctx());
    scenario.next_tx(ADMIN);
    let mut house = scenario.take_shared<House<TEST_USDC>>();
    let cap = house.issue_operator_cap(&admin, scenario.ctx());
    transfer::public_transfer(cap, OPERATOR);
    ts::return_shared(house);
    scenario.return_to_sender(admin);
    scenario.next_tx(OPERATOR);
    let clock = clock::create_for_testing(scenario.ctx());
    (scenario, clock)
}

fun open(scenario: &mut Scenario, clock: &Clock, battle_id: u64): ID {
    scenario.next_tx(OPERATOR);
    let mut house = scenario.take_shared<House<TEST_USDC>>();
    let cap = scenario.take_from_sender<OperatorCap>();
    let id = house.open_pool(&cap, battle_id.to_string(), clock.timestamp_ms() + WINDOW, clock);
    scenario.return_to_sender(cap);
    ts::return_shared(house);
    id
}

fun bet_as(
    scenario: &mut Scenario,
    clock: &Clock,
    pool_id: ID,
    bettor: address,
    sponsor: address,
    side: u64,
    amount: u64,
) {
    let rgp = scenario.ctx().reference_gas_price();
    scenario.next_with_context(
        ts::ctx_builder_from_sender(bettor).set_reference_gas_price(rgp).set_sponsor(sponsor),
    );
    let house = scenario.take_shared<House<TEST_USDC>>();
    let mut pool = scenario.take_shared_by_id<Pool<TEST_USDC>>(pool_id);
    let payment = coin::mint_for_testing<TEST_USDC>(amount, scenario.ctx());
    let ticket = house.place_bet(&mut pool, side, payment, clock, scenario.ctx());
    transfer::public_transfer(ticket, bettor);
    ts::return_shared(pool);
    ts::return_shared(house);
}

fun bet(scenario: &mut Scenario, clock: &Clock, pool_id: ID, bettor: address, side: u64, amount: u64) {
    bet_as(scenario, clock, pool_id, bettor, SPONSOR, side, amount);
}

fun close(scenario: &mut Scenario, clock: &Clock, pool_id: ID) {
    scenario.next_tx(OPERATOR);
    let house = scenario.take_shared<House<TEST_USDC>>();
    let mut pool = scenario.take_shared_by_id<Pool<TEST_USDC>>(pool_id);
    let cap = scenario.take_from_sender<OperatorCap>();
    house.close_betting(&cap, &mut pool, clock);
    scenario.return_to_sender(cap);
    ts::return_shared(pool);
    ts::return_shared(house);
}

fun settle(scenario: &mut Scenario, clock: &Clock, pool_id: ID, winning_side: u64) {
    scenario.next_tx(OPERATOR);
    let mut house = scenario.take_shared<House<TEST_USDC>>();
    let mut pool = scenario.take_shared_by_id<Pool<TEST_USDC>>(pool_id);
    let cap = scenario.take_from_sender<OperatorCap>();
    house.settle(&cap, &mut pool, winning_side, clock);
    scenario.return_to_sender(cap);
    ts::return_shared(pool);
    ts::return_shared(house);
}

fun cancel(scenario: &mut Scenario, pool_id: ID) {
    scenario.next_tx(OPERATOR);
    let house = scenario.take_shared<House<TEST_USDC>>();
    let mut pool = scenario.take_shared_by_id<Pool<TEST_USDC>>(pool_id);
    let cap = scenario.take_from_sender<OperatorCap>();
    house.cancel(&cap, &mut pool);
    scenario.return_to_sender(cap);
    ts::return_shared(pool);
    ts::return_shared(house);
}

fun redeem(scenario: &mut Scenario, pool_id: ID, bettor: address): u64 {
    scenario.next_tx(bettor);
    let mut pool = scenario.take_shared_by_id<Pool<TEST_USDC>>(pool_id);
    let ticket = scenario.take_from_sender<Ticket<TEST_USDC>>();
    let payout = pool.redeem(ticket, scenario.ctx());
    let value = payout.value();
    destroy(payout);
    ts::return_shared(pool);
    value
}

fun treasury(scenario: &mut Scenario): u64 {
    scenario.next_tx(ADMIN);
    let house = scenario.take_shared<House<TEST_USDC>>();
    let value = house.treasury();
    ts::return_shared(house);
    value
}

fun set_fee(scenario: &mut Scenario, fee_bps: u64) {
    scenario.next_tx(ADMIN);
    let mut house = scenario.take_shared<House<TEST_USDC>>();
    let admin = scenario.take_from_sender<AdminCap>();
    house.set_fee_bps(&admin, fee_bps);
    scenario.return_to_sender(admin);
    ts::return_shared(house);
}

fun finish(scenario: Scenario, clock: Clock) {
    clock.destroy_for_testing();
    scenario.end();
}

#[test]
fun winners_split_the_pool_after_a_fee_from_the_losing_side() {
    let (mut scenario, mut clock) = setup();
    let pool = open(&mut scenario, &clock, 1);
    bet(&mut scenario, &clock, pool, ALICE, 0, 30_000_000);
    bet(&mut scenario, &clock, pool, BOB, 0, 10_000_000);
    bet(&mut scenario, &clock, pool, CAROL, 1, 40_000_000);
    clock.increment_for_testing(WINDOW);
    settle(&mut scenario, &clock, pool, 0);

    assert_eq!(redeem(&mut scenario, pool, ALICE), 59_400_000);
    assert_eq!(redeem(&mut scenario, pool, BOB), 19_800_000);
    assert_eq!(redeem(&mut scenario, pool, CAROL), 0);
    assert_eq!(treasury(&mut scenario), 800_000);
    finish(scenario, clock);
}

#[test, expected_failure(abort_code = betting::EBetNotSponsored, location = betting)]
fun a_bet_without_a_sponsor_aborts() {
    let (mut scenario, clock) = setup();
    let pool = open(&mut scenario, &clock, 1);
    scenario.next_tx(ALICE);
    let house = scenario.take_shared<House<TEST_USDC>>();
    let mut pool = scenario.take_shared_by_id<Pool<TEST_USDC>>(pool);
    let payment = coin::mint_for_testing<TEST_USDC>(MIN_BET, scenario.ctx());
    let _ticket = house.place_bet(&mut pool, 0, payment, &clock, scenario.ctx());
    abort
}

#[test, expected_failure(abort_code = betting::EBetNotSponsored, location = betting)]
fun a_bet_from_another_sponsor_aborts() {
    let (mut scenario, clock) = setup();
    let pool = open(&mut scenario, &clock, 1);
    bet_as(&mut scenario, &clock, pool, ALICE, @0xBAD, 0, MIN_BET);
    abort
}

#[test, expected_failure(abort_code = betting::EBetBelowMinimum, location = betting)]
fun a_bet_below_the_minimum_aborts() {
    let (mut scenario, clock) = setup();
    let pool = open(&mut scenario, &clock, 1);
    bet(&mut scenario, &clock, pool, ALICE, 0, MIN_BET - 1);
    abort
}

#[test, expected_failure(abort_code = betting::EInvalidSide, location = betting)]
fun a_bet_on_a_third_side_aborts() {
    let (mut scenario, clock) = setup();
    let pool = open(&mut scenario, &clock, 1);
    bet(&mut scenario, &clock, pool, ALICE, 2, MIN_BET);
    abort
}

#[test, expected_failure(abort_code = betting::EBettingClosed, location = betting)]
fun a_bet_at_the_close_time_aborts() {
    let (mut scenario, mut clock) = setup();
    let pool = open(&mut scenario, &clock, 1);
    clock.increment_for_testing(WINDOW);
    bet(&mut scenario, &clock, pool, ALICE, 0, MIN_BET);
    abort
}

#[test]
fun closing_early_ends_betting_and_allows_settling_at_once() {
    let (mut scenario, mut clock) = setup();
    let pool = open(&mut scenario, &clock, 1);
    bet(&mut scenario, &clock, pool, ALICE, 0, MIN_BET);
    bet(&mut scenario, &clock, pool, BOB, 1, MIN_BET);
    clock.increment_for_testing(WINDOW / 2);
    close(&mut scenario, &clock, pool);
    settle(&mut scenario, &clock, pool, 1);
    assert_eq!(redeem(&mut scenario, pool, BOB), 2 * MIN_BET - MIN_BET * FEE_BPS / 10_000);
    finish(scenario, clock);
}

#[test, expected_failure(abort_code = betting::EBettingStillOpen, location = betting)]
fun settling_before_betting_closes_aborts() {
    let (mut scenario, clock) = setup();
    let pool = open(&mut scenario, &clock, 1);
    settle(&mut scenario, &clock, pool, 0);
    abort
}

#[test]
fun cancelled_and_one_sided_pools_refund_every_stake_without_fee() {
    let (mut scenario, mut clock) = setup();
    let cancelled = open(&mut scenario, &clock, 1);
    bet(&mut scenario, &clock, cancelled, ALICE, 0, 30_000_000);
    bet(&mut scenario, &clock, cancelled, BOB, 1, 20_000_000);
    cancel(&mut scenario, cancelled);
    assert_eq!(redeem(&mut scenario, cancelled, ALICE), 30_000_000);
    assert_eq!(redeem(&mut scenario, cancelled, BOB), 20_000_000);

    let one_sided = open(&mut scenario, &clock, 2);
    bet(&mut scenario, &clock, one_sided, CAROL, 1, 40_000_000);
    clock.increment_for_testing(WINDOW);
    settle(&mut scenario, &clock, one_sided, 0);
    assert_eq!(redeem(&mut scenario, one_sided, CAROL), 40_000_000);
    assert_eq!(treasury(&mut scenario), 0);
    finish(scenario, clock);
}

#[test]
fun a_fee_change_applies_only_to_pools_opened_after_it() {
    let (mut scenario, mut clock) = setup();
    let before = open(&mut scenario, &clock, 1);
    set_fee(&mut scenario, 1_000);
    let after = open(&mut scenario, &clock, 2);
    bet(&mut scenario, &clock, before, ALICE, 0, 10_000_000);
    bet(&mut scenario, &clock, before, BOB, 1, 10_000_000);
    bet(&mut scenario, &clock, after, CAROL, 0, 10_000_000);
    bet(&mut scenario, &clock, after, @0xD0, 1, 10_000_000);
    clock.increment_for_testing(WINDOW);
    settle(&mut scenario, &clock, before, 0);
    settle(&mut scenario, &clock, after, 0);
    assert_eq!(redeem(&mut scenario, before, ALICE), 19_800_000);
    assert_eq!(redeem(&mut scenario, after, CAROL), 19_000_000);
    finish(scenario, clock);
}

#[test, expected_failure(abort_code = betting::EFeeTooHigh, location = betting)]
fun a_fee_above_the_maximum_aborts() {
    let (mut scenario, clock) = setup();
    set_fee(&mut scenario, 1_001);
    finish(scenario, clock);
}

#[test, expected_failure(abort_code = betting::ERevokedOperator, location = betting)]
fun a_revoked_operator_cap_cannot_open_pools() {
    let (mut scenario, clock) = setup();
    scenario.next_tx(OPERATOR);
    let cap = scenario.take_from_sender<OperatorCap>();
    let cap_id = object::id(&cap);
    scenario.return_to_sender(cap);
    scenario.next_tx(ADMIN);
    let mut house = scenario.take_shared<House<TEST_USDC>>();
    let admin = scenario.take_from_sender<AdminCap>();
    house.revoke_operator_cap(&admin, cap_id);
    scenario.return_to_sender(admin);
    ts::return_shared(house);
    open(&mut scenario, &clock, 1);
    abort
}

#[test, expected_failure(abort_code = betting::EWrongHouse, location = betting)]
fun an_operator_cap_for_another_house_is_rejected() {
    let (mut scenario, clock) = setup();
    scenario.next_tx(ADMIN);
    let admin = scenario.take_from_sender<AdminCap>();
    betting::create_house<OTHER_COIN>(&admin, FEE_BPS, MIN_BET, SPONSOR, scenario.ctx());
    scenario.return_to_sender(admin);
    scenario.next_tx(OPERATOR);
    let mut other = scenario.take_shared<House<OTHER_COIN>>();
    let cap = scenario.take_from_sender<OperatorCap>();
    other.open_pool(&cap, b"1".to_string(), clock.timestamp_ms() + WINDOW, &clock);
    abort
}

#[test, expected_failure]
fun a_battle_can_only_have_one_pool() {
    let (mut scenario, clock) = setup();
    open(&mut scenario, &clock, 7);
    open(&mut scenario, &clock, 7);
    abort
}

#[test]
fun pool_ids_derive_from_the_house_and_battle_id() {
    let (mut scenario, clock) = setup();
    let pool = open(&mut scenario, &clock, 7);
    scenario.next_tx(ADMIN);
    let house = scenario.take_shared<House<TEST_USDC>>();
    assert_eq!(house.pool_address(7u64.to_string()), pool.to_address());
    ts::return_shared(house);
    finish(scenario, clock);
}

#[test]
fun pool_address_matches_the_typescript_sdk() {
    assert_eq!(
        betting::pool_address_for_testing(
            object::id_from_address(@0x1234),
            b"0b7c7c1e-2f3a-4d5e-8f90-123456789abc".to_string(),
        ),
        @0x6f246af362345df932f4f23a43e8c86692cdbb6b085c390d39af9ad3fbebe311,
    );
}

#[test]
fun withdrawing_fees_empties_the_treasury() {
    let (mut scenario, mut clock) = setup();
    let pool = open(&mut scenario, &clock, 1);
    bet(&mut scenario, &clock, pool, ALICE, 0, 30_000_000);
    bet(&mut scenario, &clock, pool, CAROL, 1, 40_000_000);
    clock.increment_for_testing(WINDOW);
    settle(&mut scenario, &clock, pool, 0);
    scenario.next_tx(ADMIN);
    let mut house = scenario.take_shared<House<TEST_USDC>>();
    let admin = scenario.take_from_sender<AdminCap>();
    let fees = house.withdraw_fees(&admin, scenario.ctx());
    assert_eq!(fees.value(), 800_000);
    assert_eq!(house.treasury(), 0);
    destroy(fees);
    scenario.return_to_sender(admin);
    ts::return_shared(house);
    assert_eq!(redeem(&mut scenario, pool, ALICE), 69_200_000);
    finish(scenario, clock);
}

#[test, expected_failure(abort_code = betting::EPoolNotFinished, location = betting)]
fun redeeming_while_the_pool_is_open_aborts() {
    let (mut scenario, clock) = setup();
    let pool = open(&mut scenario, &clock, 1);
    bet(&mut scenario, &clock, pool, ALICE, 0, MIN_BET);
    redeem(&mut scenario, pool, ALICE);
    abort
}

#[test, expected_failure(abort_code = betting::EWrongPool, location = betting)]
fun redeeming_a_ticket_against_another_pool_aborts() {
    let (mut scenario, clock) = setup();
    let first = open(&mut scenario, &clock, 1);
    let second = open(&mut scenario, &clock, 2);
    bet(&mut scenario, &clock, first, ALICE, 0, MIN_BET);
    cancel(&mut scenario, second);
    redeem(&mut scenario, second, ALICE);
    abort
}

#[test]
fun payouts_never_exceed_the_pool() {
    let (mut scenario, mut clock) = setup();
    let bettors = vector[@0x1001, @0x1002, @0x1003, @0x1004, @0x1005];
    let mut seed = 7u64;
    20u64.do!(|round| {
        let pool = open(&mut scenario, &clock, round + 1);
        let mut staked = 0;
        bettors.do_ref!(|bettor| {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            let amount = MIN_BET + seed % 50_000_000;
            bet(&mut scenario, &clock, pool, *bettor, seed % 2, amount);
            staked = staked + amount;
        });
        clock.increment_for_testing(WINDOW);
        let fees_before = treasury(&mut scenario);
        settle(&mut scenario, &clock, pool, round % 2);
        let fee = treasury(&mut scenario) - fees_before;
        let mut paid = 0;
        bettors.do_ref!(|bettor| paid = paid + redeem(&mut scenario, pool, *bettor));
        assert!(paid + fee <= staked);
        assert!(staked - paid - fee <= bettors.length());
    });
    finish(scenario, clock);
}
