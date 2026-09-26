/// Parimutuel bet pools for Horror Tube battles, paid in one coin type per
/// house. Battle state (fighters, winner) lives in the game database and ENS;
/// a pool knows only its battle's database ID and two sides. The game server
/// opens, closes and settles pools. Players bet through the game server's
/// wallet API, which checks World ID; the package itself does not enforce that.
module horror_tube::betting;

use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::derived_object;
use sui::event;
use sui::vec_set::{Self, VecSet};

const BPS: u64 = 10_000;
const MAX_FEE_BPS: u64 = 1_000;

const OPEN: u8 = 0;
const SETTLED: u8 = 1;
const CANCELLED: u8 = 2;

#[error]
const EWrongHouse: vector<u8> = b"The object belongs to a different house.";
#[error]
const ERevokedOperator: vector<u8> = b"This operator cap was revoked.";
#[error]
const EFeeTooHigh: vector<u8> = b"Fee is above the maximum.";
#[error]
const EZeroMinBet: vector<u8> = b"Minimum bet must be above zero.";
#[error]
const EClosesAtNotInFuture: vector<u8> = b"Betting must close in the future.";
#[error]
const EPoolNotOpen: vector<u8> = b"The pool is settled or cancelled.";
#[error]
const EBettingClosed: vector<u8> = b"Betting on this pool has closed.";
#[error]
const EBettingStillOpen: vector<u8> = b"Betting on this pool is still open.";
#[error]
const EInvalidSide: vector<u8> = b"Side must be 0 or 1.";
#[error]
const EBetBelowMinimum: vector<u8> = b"Bet is below the house minimum.";
#[error]
const EPoolNotFinished: vector<u8> = b"The pool is not settled or cancelled yet.";
#[error]
const EWrongPool: vector<u8> = b"The ticket is for a different pool.";
#[error]
const ENothingToWithdraw: vector<u8> = b"The treasury is empty.";

public struct AdminCap has key, store { id: UID }

public struct OperatorCap has key, store {
    id: UID,
    house_id: ID,
}

public struct House<phantom T> has key {
    id: UID,
    fee_bps: u64,
    min_bet: u64,
    operators: VecSet<ID>,
    treasury: Balance<T>,
}

/// A pool's ID derives from its house and its battle's database ID, so the
/// app finds a pool from the battle alone and no battle gets two pools.
public struct PoolKey(String) has copy, drop, store;

public struct Pool<phantom T> has key {
    id: UID,
    house_id: ID,
    battle_id: String,
    closes_at_ms: u64,
    fee_bps: u64,
    status: u8,
    winning_side: u64,
    fee: u64,
    totals: vector<u64>,
    pot: Balance<T>,
}

public struct Ticket<phantom T> has key, store {
    id: UID,
    pool_id: ID,
    side: u64,
    stake: u64,
}

public struct HouseCreated has copy, drop {
    house_id: ID,
    fee_bps: u64,
    min_bet: u64,
}

public struct HouseConfigChanged has copy, drop {
    house_id: ID,
    fee_bps: u64,
    min_bet: u64,
}

public struct OperatorCapIssued has copy, drop { house_id: ID, cap_id: ID }

public struct OperatorCapRevoked has copy, drop { house_id: ID, cap_id: ID }

public struct FeesWithdrawn has copy, drop { house_id: ID, amount: u64 }

public struct PoolOpened has copy, drop {
    house_id: ID,
    pool_id: ID,
    battle_id: String,
    closes_at_ms: u64,
    fee_bps: u64,
}

public struct BetPlaced has copy, drop {
    pool_id: ID,
    battle_id: String,
    ticket_id: ID,
    side: u64,
    stake: u64,
}

public struct BettingClosed has copy, drop { pool_id: ID, battle_id: String, closes_at_ms: u64 }

public struct PoolSettled has copy, drop {
    pool_id: ID,
    battle_id: String,
    winning_side: u64,
    fee: u64,
}

public struct PoolCancelled has copy, drop { pool_id: ID, battle_id: String }

public struct TicketRedeemed has copy, drop { pool_id: ID, ticket_id: ID, payout: u64 }

fun init(ctx: &mut TxContext) {
    transfer::public_transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

public fun create_house<T>(_: &AdminCap, fee_bps: u64, min_bet: u64, ctx: &mut TxContext) {
    assert!(fee_bps <= MAX_FEE_BPS, EFeeTooHigh);
    assert!(min_bet > 0, EZeroMinBet);
    let house = House<T> {
        id: object::new(ctx),
        fee_bps,
        min_bet,
        operators: vec_set::empty(),
        treasury: balance::zero(),
    };
    event::emit(HouseCreated { house_id: object::id(&house), fee_bps, min_bet });
    transfer::share_object(house);
}

public fun issue_operator_cap<T>(
    house: &mut House<T>,
    _: &AdminCap,
    ctx: &mut TxContext,
): OperatorCap {
    let house_id = object::id(house);
    let cap = OperatorCap { id: object::new(ctx), house_id };
    house.operators.insert(object::id(&cap));
    event::emit(OperatorCapIssued { house_id, cap_id: object::id(&cap) });
    cap
}

public fun revoke_operator_cap<T>(house: &mut House<T>, _: &AdminCap, cap_id: ID) {
    house.operators.remove(&cap_id);
    event::emit(OperatorCapRevoked { house_id: object::id(house), cap_id });
}

public fun set_fee_bps<T>(house: &mut House<T>, _: &AdminCap, fee_bps: u64) {
    assert!(fee_bps <= MAX_FEE_BPS, EFeeTooHigh);
    house.fee_bps = fee_bps;
    house.emit_config();
}

public fun set_min_bet<T>(house: &mut House<T>, _: &AdminCap, min_bet: u64) {
    assert!(min_bet > 0, EZeroMinBet);
    house.min_bet = min_bet;
    house.emit_config();
}

public fun withdraw_fees<T>(house: &mut House<T>, _: &AdminCap, ctx: &mut TxContext): Coin<T> {
    let amount = house.treasury.value();
    assert!(amount > 0, ENothingToWithdraw);
    event::emit(FeesWithdrawn { house_id: object::id(house), amount });
    coin::from_balance(house.treasury.withdraw_all(), ctx)
}

public fun open_pool<T>(
    house: &mut House<T>,
    cap: &OperatorCap,
    battle_id: String,
    closes_at_ms: u64,
    clock: &Clock,
): ID {
    house.assert_operator(cap);
    assert!(closes_at_ms > clock.timestamp_ms(), EClosesAtNotInFuture);
    let pool = Pool<T> {
        id: derived_object::claim(&mut house.id, PoolKey(battle_id)),
        house_id: object::id(house),
        battle_id,
        closes_at_ms,
        fee_bps: house.fee_bps,
        status: OPEN,
        winning_side: 0,
        fee: 0,
        totals: vector[0, 0],
        pot: balance::zero(),
    };
    let pool_id = object::id(&pool);
    event::emit(PoolOpened {
        house_id: pool.house_id,
        pool_id,
        battle_id,
        closes_at_ms,
        fee_bps: pool.fee_bps,
    });
    transfer::share_object(pool);
    pool_id
}

public fun place_bet<T>(
    house: &House<T>,
    pool: &mut Pool<T>,
    side: u64,
    payment: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
): Ticket<T> {
    house.assert_owns(pool);
    assert!(pool.status == OPEN, EPoolNotOpen);
    assert!(clock.timestamp_ms() < pool.closes_at_ms, EBettingClosed);
    assert!(side < 2, EInvalidSide);
    let stake = payment.value();
    assert!(stake >= house.min_bet, EBetBelowMinimum);
    let total = &mut pool.totals[side];
    *total = *total + stake;
    pool.pot.join(payment.into_balance());
    let ticket = Ticket<T> { id: object::new(ctx), pool_id: object::id(pool), side, stake };
    event::emit(BetPlaced {
        pool_id: ticket.pool_id,
        battle_id: pool.battle_id,
        ticket_id: object::id(&ticket),
        side,
        stake,
    });
    ticket
}

entry fun bet<T>(
    house: &House<T>,
    pool: &mut Pool<T>,
    side: u64,
    payment: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let ticket = place_bet(house, pool, side, payment, clock, ctx);
    transfer::public_transfer(ticket, ctx.sender());
}

public fun close_betting<T>(house: &House<T>, cap: &OperatorCap, pool: &mut Pool<T>, clock: &Clock) {
    house.assert_operator(cap);
    house.assert_owns(pool);
    assert!(pool.status == OPEN, EPoolNotOpen);
    let now = clock.timestamp_ms();
    assert!(now < pool.closes_at_ms, EBettingClosed);
    pool.closes_at_ms = now;
    event::emit(BettingClosed {
        pool_id: object::id(pool),
        battle_id: pool.battle_id,
        closes_at_ms: now,
    });
}

public fun settle<T>(
    house: &mut House<T>,
    cap: &OperatorCap,
    pool: &mut Pool<T>,
    winning_side: u64,
    clock: &Clock,
) {
    house.assert_operator(cap);
    house.assert_owns(pool);
    assert!(pool.status == OPEN, EPoolNotOpen);
    assert!(clock.timestamp_ms() >= pool.closes_at_ms, EBettingStillOpen);
    assert!(winning_side < 2, EInvalidSide);
    let winner_total = pool.totals[winning_side];
    let loser_total = pool.totals[1 - winning_side];
    let fee = if (winner_total == 0 || loser_total == 0) 0
    else std::u64::mul_div(loser_total, pool.fee_bps, BPS);
    house.treasury.join(pool.pot.split(fee));
    pool.status = SETTLED;
    pool.winning_side = winning_side;
    pool.fee = fee;
    event::emit(PoolSettled {
        pool_id: object::id(pool),
        battle_id: pool.battle_id,
        winning_side,
        fee,
    });
}

public fun cancel<T>(house: &House<T>, cap: &OperatorCap, pool: &mut Pool<T>) {
    house.assert_operator(cap);
    house.assert_owns(pool);
    assert!(pool.status == OPEN, EPoolNotOpen);
    pool.status = CANCELLED;
    event::emit(PoolCancelled { pool_id: object::id(pool), battle_id: pool.battle_id });
}

/// Open to any ticket holder, sponsored or not, so winnings never depend on
/// the game server being up.
public fun redeem<T>(pool: &mut Pool<T>, ticket: Ticket<T>, ctx: &mut TxContext): Coin<T> {
    assert!(pool.status != OPEN, EPoolNotFinished);
    let payout = pool.payout(&ticket);
    let Ticket { id, .. } = ticket;
    event::emit(TicketRedeemed { pool_id: object::id(pool), ticket_id: id.to_inner(), payout });
    id.delete();
    coin::take(&mut pool.pot, payout, ctx)
}

/// Pays into the sender's address balance, which is what the game wallet
/// spends from.
entry fun claim<T>(pool: &mut Pool<T>, ticket: Ticket<T>, ctx: &mut TxContext) {
    let payout = redeem(pool, ticket, ctx);
    if (payout.value() == 0) payout.destroy_zero()
    else coin::send_funds(payout, ctx.sender());
}

/// What `redeem` pays for this ticket; 0 while the pool is open.
public fun payout<T>(pool: &Pool<T>, ticket: &Ticket<T>): u64 {
    assert!(ticket.pool_id == object::id(pool), EWrongPool);
    if (pool.status == OPEN) return 0;
    let winner_total = pool.totals[pool.winning_side];
    let loser_total = pool.totals[1 - pool.winning_side];
    if (pool.status == CANCELLED || winner_total == 0 || loser_total == 0) return ticket.stake;
    if (ticket.side != pool.winning_side) return 0;
    std::u64::mul_div(ticket.stake, winner_total + loser_total - pool.fee, winner_total)
}

/// The object ID the pool for `battle_id` has or will have in this house.
public fun pool_address<T>(house: &House<T>, battle_id: String): address {
    derived_object::derive_address(object::id(house), PoolKey(battle_id))
}

public fun pool_battle_id<T>(pool: &Pool<T>): String { pool.battle_id }

public fun pool_status<T>(pool: &Pool<T>): u8 { pool.status }

public fun pool_winning_side<T>(pool: &Pool<T>): u64 { pool.winning_side }

public fun pool_fee_bps<T>(pool: &Pool<T>): u64 { pool.fee_bps }

public fun pool_totals<T>(pool: &Pool<T>): vector<u64> { pool.totals }

public fun pool_pot<T>(pool: &Pool<T>): u64 { pool.pot.value() }

public fun ticket_stake<T>(ticket: &Ticket<T>): u64 { ticket.stake }

public fun treasury<T>(house: &House<T>): u64 { house.treasury.value() }

fun assert_operator<T>(house: &House<T>, cap: &OperatorCap) {
    assert!(cap.house_id == object::id(house), EWrongHouse);
    assert!(house.operators.contains(&object::id(cap)), ERevokedOperator);
}

fun assert_owns<T>(house: &House<T>, pool: &Pool<T>) {
    assert!(pool.house_id == object::id(house), EWrongHouse);
}

fun emit_config<T>(house: &House<T>) {
    event::emit(HouseConfigChanged {
        house_id: object::id(house),
        fee_bps: house.fee_bps,
        min_bet: house.min_bet,
    });
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx);
}

#[test_only]
public fun pool_address_for_testing(house_id: ID, battle_id: String): address {
    derived_object::derive_address(house_id, PoolKey(battle_id))
}
