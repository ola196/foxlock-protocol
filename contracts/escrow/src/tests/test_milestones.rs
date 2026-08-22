//! Tests for milestone submit, approve, and reject flows.

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use crate::errors::EscrowError;
use crate::types::{EscrowStatus, MilestoneStatus};
use super::helpers::*;

#[test]
fn test_full_happy_path() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let arbitrator_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);
    let id = escrow
        .create_escrow(
            &client_addr,
            &contributor_addr,
            &arbitrator_addr,
            &token_addr,
            &two_milestones(&env),
            &(env.ledger().sequence() + 1000),
            &String::from_str(&env, "Happy path"),
            &0u32, // no cliff
        );

    // Submit milestone 0
    escrow.submit_milestone(
        &contributor_addr,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://Qm...design"),
    );

    // Approve milestone 0 — 500 tokens released
    escrow.approve_milestone(&client_addr, &id, &0u32);
    assert_eq!(balance(&env, &token_addr, &contributor_addr), 500);

    // Submit and approve milestone 1 — final 500 tokens released
    escrow.submit_milestone(
        &contributor_addr,
        &id,
        &1u32,
        &String::from_str(&env, "ipfs://Qm...impl"),
    );
    escrow.approve_milestone(&client_addr, &id, &1u32);
    assert_eq!(balance(&env, &token_addr, &contributor_addr), 1000);

    // Escrow should be completed
    let record = escrow.get_escrow(&id);
    assert_eq!(record.status, EscrowStatus::Completed);
    assert_eq!(record.released_amount, 1000);
}

#[test]
fn test_reject_and_resubmit() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);
    let id = escrow
        .create_escrow(
            &client_addr,
            &contributor_addr,
            &Address::generate(&env),
            &token_addr,
            &two_milestones(&env),
            &(env.ledger().sequence() + 1000),
            &String::from_str(&env, "Reject test"),
            &0u32, // no cliff
        );

    // Submit milestone 0
    escrow.submit_milestone(
        &contributor_addr,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://bad-proof"),
    );

    // Client rejects
    escrow.reject_milestone(&client_addr, &id, &0u32);

    let record = escrow.get_escrow(&id);
    assert_eq!(
        record.milestones.get(0).unwrap().status,
        MilestoneStatus::Rejected
    );

    // Contributor resubmits with better proof
    escrow.submit_milestone(
        &contributor_addr,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://better-proof"),
    );

    // Client approves the second submission
    escrow.approve_milestone(&client_addr, &id, &0u32);
    assert_eq!(balance(&env, &token_addr, &contributor_addr), 500);
}

#[test]
fn test_unauthorized_submit_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let impostor = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);
    let id = escrow
        .create_escrow(
            &client_addr,
            &contributor_addr,
            &Address::generate(&env),
            &token_addr,
            &two_milestones(&env),
            &(env.ledger().sequence() + 1000),
            &String::from_str(&env, "Auth test"),
            &0u32, // no cliff
        );

    // Impostor tries to submit
    let result = escrow.try_submit_milestone(
        &impostor,
        &id,
        &0u32,
        &String::from_str(&env, "ipfs://fake"),
    );
    assert_eq!(result, Err(Ok(EscrowError::Unauthorized)));
}

#[test]
fn test_approve_non_submitted_milestone_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);
    let id = escrow
        .create_escrow(
            &client_addr,
            &Address::generate(&env),
            &Address::generate(&env),
            &token_addr,
            &two_milestones(&env),
            &(env.ledger().sequence() + 1000),
            &String::from_str(&env, "Double approve test"),
            &0u32, // no cliff
        );

    // Try to approve without submission
    let result = escrow.try_approve_milestone(&client_addr, &id, &0u32);
    assert_eq!(result, Err(Ok(EscrowError::InvalidMilestoneStatus)));
}
