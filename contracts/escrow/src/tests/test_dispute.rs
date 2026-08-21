//! Integration tests for dispute resolution flow.
//! Closes #40

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use crate::errors::EscrowError;
use crate::types::EscrowStatus;
use super::helpers::*;

#[test]
fn test_dispute_full_to_contributor() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let arbitrator_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);
    let id = escrow.create_escrow(
        &client_addr, &contributor_addr, &arbitrator_addr,
        &token_addr, &two_milestones(&env),
        &(env.ledger().sequence() + 1000),
        &String::from_str(&env, "Dispute full contributor"),
    ).unwrap();

    // Contributor submits milestone
    escrow.submit_milestone(
        &contributor_addr, &id, &0u32,
        &String::from_str(&env, "ipfs://proof1"),
    ).unwrap();

    // Client raises dispute instead of approving
    escrow.raise_dispute(&client_addr, &id).unwrap();

    let record = escrow.get_escrow(&id);
    assert_eq!(record.status, EscrowStatus::Disputed);

    // Arbitrator awards everything to contributor
    escrow.resolve_dispute(&arbitrator_addr, &id, &0i128, &1000i128).unwrap();

    assert_eq!(balance(&env, &token_addr, &contributor_addr), 1000);
    assert_eq!(balance(&env, &token_addr, &client_addr), 0);

    let resolved = escrow.get_escrow(&id);
    assert_eq!(resolved.status, EscrowStatus::Completed);
}

#[test]
fn test_dispute_full_to_client() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let arbitrator_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);
    let id = escrow.create_escrow(
        &client_addr, &contributor_addr, &arbitrator_addr,
        &token_addr, &two_milestones(&env),
        &(env.ledger().sequence() + 1000),
        &String::from_str(&env, "Dispute full client"),
    ).unwrap();

    // Contributor raises dispute
    escrow.raise_dispute(&contributor_addr, &id).unwrap();

    // Arbitrator awards everything to client
    escrow.resolve_dispute(&arbitrator_addr, &id, &1000i128, &0i128).unwrap();

    assert_eq!(balance(&env, &token_addr, &client_addr), 1000);
    assert_eq!(balance(&env, &token_addr, &contributor_addr), 0);
}

#[test]
fn test_dispute_partial_split() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let arbitrator_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);
    let id = escrow.create_escrow(
        &client_addr, &contributor_addr, &arbitrator_addr,
        &token_addr, &two_milestones(&env),
        &(env.ledger().sequence() + 1000),
        &String::from_str(&env, "Dispute partial split"),
    ).unwrap();

    escrow.raise_dispute(&client_addr, &id);

    // Arbitrator splits 70/30
    escrow.resolve_dispute(&arbitrator_addr, &id, &700i128, &300i128).unwrap();

    assert_eq!(balance(&env, &token_addr, &client_addr), 700);
    assert_eq!(balance(&env, &token_addr, &contributor_addr), 300);
}

#[test]
fn test_dispute_after_partial_release() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let arbitrator_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);
    let id = escrow.create_escrow(
        &client_addr, &contributor_addr, &arbitrator_addr,
        &token_addr, &two_milestones(&env),
        &(env.ledger().sequence() + 1000),
        &String::from_str(&env, "Dispute after partial"),
    ).unwrap();

    // Client approves first milestone (500 released)
    escrow.submit_milestone(
        &contributor_addr, &id, &0u32,
        &String::from_str(&env, "proof1"),
    ).unwrap();
    escrow.approve_milestone(&client_addr, &id, &0u32).unwrap();
    assert_eq!(balance(&env, &token_addr, &contributor_addr), 500);

    // Now dispute on remaining 500
    escrow.raise_dispute(&client_addr, &id).unwrap();

    // Arbitrator splits remaining 500 as 200/300
    escrow.resolve_dispute(&arbitrator_addr, &id, &200i128, &300i128).unwrap();

    assert_eq!(balance(&env, &token_addr, &client_addr), 200);
    assert_eq!(balance(&env, &token_addr, &contributor_addr), 800); // 500 + 300
}

#[test]
fn test_dispute_resolution_wrong_sum_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let arbitrator_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);
    let id = escrow.create_escrow(
        &client_addr, &Address::generate(&env), &arbitrator_addr,
        &token_addr, &two_milestones(&env),
        &(env.ledger().sequence() + 1000),
        &String::from_str(&env, "Wrong sum"),
    ).unwrap();

    escrow.raise_dispute(&client_addr, &id).unwrap();

    // 400 + 400 = 800, but total is 1000 — should fail
    let result = escrow.try_resolve_dispute(&arbitrator_addr, &id, &400i128, &400i128);
    assert_eq!(result, Err(Ok(EscrowError::AmountMismatch)));
}

#[test]
fn test_cannot_dispute_completed_escrow() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);
    let id = escrow.create_escrow(
        &client_addr, &contributor_addr, &Address::generate(&env),
        &token_addr, &two_milestones(&env),
        &(env.ledger().sequence() + 1000),
        &String::from_str(&env, "Completed dispute"),
    ).unwrap();

    // Complete the escrow
    escrow.submit_milestone(&contributor_addr, &id, &0u32, &String::from_str(&env, "p1")).unwrap();
    escrow.approve_milestone(&client_addr, &id, &0u32).unwrap();
    escrow.submit_milestone(&contributor_addr, &id, &1u32, &String::from_str(&env, "p2")).unwrap();
    escrow.approve_milestone(&client_addr, &id, &1u32).unwrap();

    // Try to raise dispute on completed escrow — should fail
    let result = escrow.try_raise_dispute(&client_addr, &id);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_unauthorized_cannot_raise_dispute() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let outsider = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);
    let id = escrow.create_escrow(
        &client_addr, &contributor_addr, &Address::generate(&env),
        &token_addr, &two_milestones(&env),
        &(env.ledger().sequence() + 1000),
        &String::from_str(&env, "Unauthorized dispute"),
    ).unwrap();

    // Outsider tries to raise dispute — should fail
    let result = escrow.try_raise_dispute(&outsider, &id);
    assert_eq!(result, Err(Ok(EscrowError::Unauthorized)));
}