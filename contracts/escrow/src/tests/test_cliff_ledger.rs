//! Tests for the optional cliff_ledger field.
//!
//! cliff_ledger = 0  → no cliff (default behaviour, all submit_milestone calls pass through).
//! cliff_ledger > 0  → milestone submissions are blocked until
//!                     env.ledger().sequence() >= cliff_ledger.

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use crate::errors::EscrowError;
use super::helpers::*;

// ── helpers ───────────────────────────────────────────────────────────────────

/// Creates an escrow with an explicit cliff and returns
/// (client, escrow_client, escrow_id, contributor).
fn setup_with_cliff(
    env: &Env,
    cliff: u32,
) -> (Address, crate::EscrowContractClient, u64, Address) {
    env.mock_all_auths();

    let client_addr = Address::generate(env);
    let contributor_addr = Address::generate(env);
    let admin = Address::generate(env);
    let (token_addr, sac) = deploy_token(env, &admin);
    mint(env, &sac, &client_addr, 1000);

    let deadline = env.ledger().sequence() + 2000;
    let escrow = deploy_escrow(env);
    let id = escrow.create_escrow(
        &client_addr,
        &contributor_addr,
        &Address::generate(env),
        &token_addr,
        &two_milestones(env),
        &deadline,
        &String::from_str(env, "Cliff test escrow"),
        &cliff,
    );

    (client_addr, escrow, id, contributor_addr)
}

// ── creation validation ───────────────────────────────────────────────────────

#[test]
fn test_cliff_stored_correctly_on_creation() {
    let env = Env::default();
    let cliff = env.ledger().sequence() + 100;
    let (_, escrow, id, _) = setup_with_cliff(&env, cliff);

    let record = escrow.get_escrow(&id);
    assert_eq!(record.cliff_ledger, cliff);
}

#[test]
fn test_no_cliff_stored_as_zero() {
    let env = Env::default();
    let (_, escrow, id, _) = setup_with_cliff(&env, 0);

    let record = escrow.get_escrow(&id);
    assert_eq!(record.cliff_ledger, 0);
}

#[test]
fn test_cliff_equal_to_deadline_rejected() {
    // cliff_ledger must be strictly less than deadline_ledger.
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let deadline = env.ledger().sequence() + 500;
    let escrow = deploy_escrow(&env);

    // cliff == deadline → invalid
    let result = escrow.try_create_escrow(
        &client_addr,
        &Address::generate(&env),
        &Address::generate(&env),
        &token_addr,
        &two_milestones(&env),
        &deadline,
        &String::from_str(&env, "Bad cliff"),
        &deadline, // cliff == deadline
    );
    assert_eq!(result, Err(Ok(EscrowError::InvalidDeadline)));
}

#[test]
fn test_cliff_after_deadline_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let deadline = env.ledger().sequence() + 500;
    let escrow = deploy_escrow(&env);

    // cliff > deadline → invalid
    let result = escrow.try_create_escrow(
        &client_addr,
        &Address::generate(&env),
        &Address::generate(&env),
        &token_addr,
        &two_milestones(&env),
        &deadline,
        &String::from_str(&env, "Bad cliff"),
        &(deadline + 1), // cliff > deadline
    );
    assert_eq!(result, Err(Ok(EscrowError::InvalidDeadline)));
}

// ── submission gating ─────────────────────────────────────────────────────────

#[test]
fn test_submit_before_cliff_fails() {
    let env = Env::default();
    let cliff = env.ledger().sequence() + 200;
    let (_, escrow, id, contributor) = setup_with_cliff(&env, cliff);

    // Ledger is still before the cliff — submit must fail
    let result = escrow.try_submit_milestone(
        &contributor,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://early"),
    );
    assert_eq!(result, Err(Ok(EscrowError::CliffNotReached)));
}

#[test]
fn test_submit_at_exact_cliff_ledger_succeeds() {
    let env = Env::default();
    let current = env.ledger().sequence();
    let cliff = current + 100;
    let (_, escrow, id, contributor) = setup_with_cliff(&env, cliff);

    // Advance to exactly the cliff ledger
    advance_ledger(&env, 100);
    assert_eq!(env.ledger().sequence(), cliff);

    // Must succeed — cliff is reached (>=)
    escrow.submit_milestone(
        &contributor,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://on-cliff"),
    );
}

#[test]
fn test_submit_after_cliff_ledger_succeeds() {
    let env = Env::default();
    let cliff = env.ledger().sequence() + 100;
    let (_, escrow, id, contributor) = setup_with_cliff(&env, cliff);

    // Advance well past the cliff
    advance_ledger(&env, 150);

    escrow.submit_milestone(
        &contributor,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://after-cliff"),
    );
}

#[test]
fn test_submit_with_no_cliff_always_succeeds() {
    // cliff_ledger == 0 → no restriction at all
    let env = Env::default();
    let (_, escrow, id, contributor) = setup_with_cliff(&env, 0);

    // No ledger advance — submit at ledger 0 should work
    escrow.submit_milestone(
        &contributor,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://no-cliff"),
    );
}

#[test]
fn test_submit_one_before_cliff_fails_one_at_cliff_succeeds() {
    // Ensures the boundary is strictly sequence >= cliff (not >)
    let env = Env::default();
    let cliff = env.ledger().sequence() + 50;
    let (_, escrow, id, contributor) = setup_with_cliff(&env, cliff);

    // Advance to cliff - 1
    advance_ledger(&env, 49);
    let result = escrow.try_submit_milestone(
        &contributor,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://too-early"),
    );
    assert_eq!(result, Err(Ok(EscrowError::CliffNotReached)));

    // Advance one more ledger to reach the cliff exactly
    advance_ledger(&env, 1);
    escrow.submit_milestone(
        &contributor,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://at-cliff"),
    );
}

// ── full flow with cliff ──────────────────────────────────────────────────────

#[test]
fn test_full_happy_path_with_cliff() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let cliff = env.ledger().sequence() + 100;
    let deadline = env.ledger().sequence() + 1000;
    let escrow = deploy_escrow(&env);
    let id = escrow.create_escrow(
        &client_addr,
        &contributor_addr,
        &Address::generate(&env),
        &token_addr,
        &two_milestones(&env),
        &deadline,
        &String::from_str(&env, "Full cliff flow"),
        &cliff,
    );

    // Attempt before cliff — blocked
    let result = escrow.try_submit_milestone(
        &contributor_addr,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://early"),
    );
    assert_eq!(result, Err(Ok(EscrowError::CliffNotReached)));

    // Advance past cliff
    advance_ledger(&env, 101);

    // Both milestones can now be submitted and approved normally
    escrow.submit_milestone(
        &contributor_addr,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://m0"),
    );
    escrow.approve_milestone(&client_addr, &id, &0u32);
    assert_eq!(balance(&env, &token_addr, &contributor_addr), 500);

    escrow.submit_milestone(
        &contributor_addr,
        &id,
        &1u32,
        &String::from_str(&env, "ipfs://m1"),
    );
    escrow.approve_milestone(&client_addr, &id, &1u32);
    assert_eq!(balance(&env, &token_addr, &contributor_addr), 1000);
}

#[test]
fn test_resubmit_after_rejection_still_respects_cliff() {
    // Even when resubmitting a rejected milestone, the cliff is enforced.
    // (This tests that the Rejected → re-submit path goes through the same cliff check.)
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let cliff = env.ledger().sequence() + 50;
    let deadline = env.ledger().sequence() + 1000;
    let escrow = deploy_escrow(&env);
    let id = escrow.create_escrow(
        &client_addr,
        &contributor_addr,
        &Address::generate(&env),
        &token_addr,
        &two_milestones(&env),
        &deadline,
        &String::from_str(&env, "Resubmit cliff"),
        &cliff,
    );

    // Advance past cliff and submit+reject milestone 0
    advance_ledger(&env, 51);
    escrow.submit_milestone(
        &contributor_addr,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://bad"),
    );
    escrow.reject_milestone(&client_addr, &id, &0u32);

    // Milestone is now Rejected. Resubmit should succeed (cliff already passed).
    escrow.submit_milestone(
        &contributor_addr,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://revised"),
    );
    escrow.approve_milestone(&client_addr, &id, &0u32);
    assert_eq!(balance(&env, &token_addr, &contributor_addr), 500);
}
