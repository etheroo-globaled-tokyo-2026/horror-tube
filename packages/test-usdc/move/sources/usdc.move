/// A free stand-in for Circle's USDC on Sui testnet. Circle's faucet is rate
/// limited and captcha gated, so the game's tests mint this coin instead.
/// It has no value and must never be used off testnet.
module test_usdc::usdc;

use sui::coin::{Self, Coin, TreasuryCap};
use sui::coin_registry;

const DECIMALS: u8 = 6;
const MAX_MINT: u64 = 1_000_000_000;

#[error]
const EZeroAmount: vector<u8> = b"Mint amount must be above zero.";
#[error]
const EAmountAboveMax: vector<u8> = b"Mint amount is above 1000 USDC per call.";

public struct USDC has drop {}

/// Shared so anyone can mint without an admin key. The per-call cap stops one
/// caller from pushing the supply to its u64 limit and breaking minting for all.
public struct Faucet has key {
    id: UID,
    treasury: TreasuryCap<USDC>,
}

fun init(otw: USDC, ctx: &mut TxContext) {
    let (currency, treasury) = coin_registry::new_currency_with_otw(
        otw,
        DECIMALS,
        b"USDC".to_string(),
        b"Horror Tube Test USDC".to_string(),
        b"Free testnet stand-in for USDC. Anyone can mint it; it has no value.".to_string(),
        b"".to_string(),
        ctx,
    );
    currency.finalize_and_delete_metadata_cap(ctx);
    transfer::share_object(Faucet { id: object::new(ctx), treasury });
}

public fun mint(faucet: &mut Faucet, amount: u64, ctx: &mut TxContext): Coin<USDC> {
    assert!(amount > 0, EZeroAmount);
    assert!(amount <= MAX_MINT, EAmountAboveMax);
    faucet.treasury.mint(amount, ctx)
}

/// The game wallet spends only from its address balance, so minted coins go
/// there rather than to a coin object.
entry fun mint_to(faucet: &mut Faucet, amount: u64, recipient: address, ctx: &mut TxContext) {
    coin::send_funds(faucet.mint(amount, ctx), recipient);
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(sui::test_utils::create_one_time_witness<USDC>(), ctx);
}
