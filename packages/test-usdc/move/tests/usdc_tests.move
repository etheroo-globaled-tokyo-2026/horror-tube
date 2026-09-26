#[test_only]
module test_usdc::usdc_tests;

use std::unit_test::{assert_eq, destroy};
use sui::test_scenario::{Self as ts, Scenario};
use test_usdc::usdc::{Self, Faucet};

const PUBLISHER: address = @0xAD;
const ALICE: address = @0xA1;
const MAX_MINT: u64 = 1_000_000_000;

fun setup(): Scenario {
    let mut scenario = ts::begin(PUBLISHER);
    usdc::init_for_testing(scenario.ctx());
    scenario
}

fun mint(scenario: &mut Scenario, amount: u64): u64 {
    scenario.next_tx(ALICE);
    let mut faucet = scenario.take_shared<Faucet>();
    let coin = faucet.mint(amount, scenario.ctx());
    let value = coin.value();
    destroy(coin);
    ts::return_shared(faucet);
    value
}

#[test]
fun mint_returns_the_amount() {
    let mut scenario = setup();
    assert_eq!(mint(&mut scenario, 42), 42);
    assert_eq!(mint(&mut scenario, MAX_MINT), MAX_MINT);
    scenario.end();
}

#[test, expected_failure(abort_code = usdc::EAmountAboveMax, location = usdc)]
fun mint_above_the_cap_aborts() {
    let mut scenario = setup();
    mint(&mut scenario, MAX_MINT + 1);
    scenario.end();
}

#[test, expected_failure(abort_code = usdc::EZeroAmount, location = usdc)]
fun mint_of_zero_aborts() {
    let mut scenario = setup();
    mint(&mut scenario, 0);
    scenario.end();
}
