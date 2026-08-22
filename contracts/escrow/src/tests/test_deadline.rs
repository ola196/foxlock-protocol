//! Tests for deadline-based claims.

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use crate::errors::EscrowError;
use crate::types::EscrowStatus;
use super::helpers::*;

#[test]
fn test_claim_after_deadline_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let deadline = env.ledger().sequence() + 100;
    let escrow = deploy_escrow(&env);
    let id = escrow
        .create_escrow(
            &client_addr,
            &contributor_addr,
            &Address::generate(&env),
            &token_addr,
            &two_milestones(&env),
            &deadline,
            &String::from_str(&env, "Deadline test"),
            &0u32, // no cliff
        );

    // Advance past deadline
    advance_ledger(&env, 101);

    escrow.claim_after_deadline(&contributor_addr, &id);

    assert_eq!(balance(&env, &token_addr, &contributor_addr), 1000);

    let record = escrow.get_escrow(&id);
    assert_eq!(record.status, EscrowStatus::Completed);
}

#[test]
fn test_claim_before_deadline_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let deadline = env.ledger().sequence() + 500;
    let escrow = deploy_escrow(&env);
    let id = escrow
        .create_escrow(
            &client_addr,
            &contributor_addr,
            &Address::generate(&env),
            &token_addr,
            &two_milestones(&env),
            &deadline,
            &String::from_str(&env, "Too early"),
            &0u32, // no cliff
        );

    // Only advance 50 ledgers (still before deadline)
    advance_ledger(&env, 50);

    let result = escrow.try_claim_after_deadline(&contributor_addr, &id);
    assert_eq!(result, Err(Ok(EscrowError::DeadlineNotReached)));
}

#[test]
fn test_partial_claim_after_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let deadline = env.ledger().sequence() + 100;
    let escrow = deploy_escrow(&env);
    let id = escrow
        .create_escrow(
            &client_addr,
            &contributor_addr,
            &Address::generate(&env),
            &token_addr,
            &two_milestones(&env),
            &deadline,
            &String::from_str(&env, "Partial deadline"),
            &0u32, // no cliff
        );

    // Client approves first milestone (500 released)
    escrow.submit_milestone(
        &contributor_addr,
        &id,
        &0u32,
        &String::from_str(&env, "proof"),
    );
    escrow.approve_milestone(&client_addr, &id, &0u32);
    assert_eq!(balance(&env, &token_addr, &contributor_addr), 500);

    // Advance past deadline
    advance_ledger(&env, 101);

    // Contributor claims the remaining 500
    escrow.claim_after_deadline(&contributor_addr, &id);

    assert_eq!(balance(&env, &token_addr, &contributor_addr), 1000);
}
