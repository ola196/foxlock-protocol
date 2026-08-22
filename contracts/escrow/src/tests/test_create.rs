//! Tests for escrow creation.

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use crate::errors::EscrowError;
use crate::types::EscrowStatus;
use super::helpers::*;

#[test]
fn test_create_escrow_success() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let arbitrator_addr = Address::generate(&env);
    let admin = Address::generate(&env);

    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);
    let milestones = two_milestones(&env);

    let id = escrow
        .create_escrow(
            &client_addr,
            &contributor_addr,
            &arbitrator_addr,
            &token_addr,
            &milestones,
            &(env.ledger().sequence() + 1000),
            &String::from_str(&env, "Test escrow"),
            &0u32, // no cliff
        );

    assert_eq!(id, 1);

    // Contract should now hold the funds
    let contract_id = escrow.address.clone();
    assert_eq!(balance(&env, &token_addr, &contract_id), 1000);
    assert_eq!(balance(&env, &token_addr, &client_addr), 0);

    let record = escrow.get_escrow(&id);
    assert_eq!(record.status, EscrowStatus::Active);
    assert_eq!(record.total_amount, 1000);
    assert_eq!(record.released_amount, 0);
    assert_eq!(record.cliff_ledger, 0);
}

#[test]
fn test_create_escrow_invalid_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let arbitrator_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);

    // Deadline in the past should fail
    let result = escrow.try_create_escrow(
        &client_addr,
        &contributor_addr,
        &arbitrator_addr,
        &token_addr,
        &two_milestones(&env),
        &0u32, // past deadline
        &String::from_str(&env, "Bad deadline"),
        &0u32, // no cliff
    );
    assert_eq!(result, Err(Ok(EscrowError::InvalidDeadline)));
}

#[test]
fn test_create_escrow_empty_milestones() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let arbitrator_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    let escrow = deploy_escrow(&env);
    let empty: soroban_sdk::Vec<crate::types::Milestone> = soroban_sdk::Vec::new(&env);

    let result = escrow.try_create_escrow(
        &client_addr,
        &contributor_addr,
        &arbitrator_addr,
        &token_addr,
        &empty,
        &(env.ledger().sequence() + 1000),
        &String::from_str(&env, "No milestones"),
        &0u32, // no cliff
    );
    assert_eq!(result, Err(Ok(EscrowError::EmptyMilestones)));
}

#[test]
fn test_escrow_count_increments() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    let escrow = deploy_escrow(&env);

    for _ in 0..3 {
        let client = Address::generate(&env);
        mint(&env, &sac, &client, 1000);
        escrow
            .create_escrow(
                &client,
                &Address::generate(&env),
                &Address::generate(&env),
                &token_addr,
                &two_milestones(&env),
                &(env.ledger().sequence() + 1000),
                &String::from_str(&env, "Multi"),
                &0u32, // no cliff
            );
    }

    assert_eq!(escrow.get_escrow_count(), 3);
}

#[test]
fn test_create_invalid_token() {
    // Passing a non-SEP-0041 contract address as `token` must be rejected
    // with EscrowError::InvalidToken before any funds are transferred.
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let arbitrator_addr = Address::generate(&env);

    // Register the escrow contract itself as a stand-in for a non-token contract.
    // It doesn't implement `decimals()`, so the SEP-0041 probe will fail.
    let fake_token_addr = env.register(crate::EscrowContract, ());

    let escrow = deploy_escrow(&env);

    let result = escrow.try_create_escrow(
        &client_addr,
        &contributor_addr,
        &arbitrator_addr,
        &fake_token_addr,
        &two_milestones(&env),
        &(env.ledger().sequence() + 1000),
        &String::from_str(&env, "Invalid token test"),
        &0u32, // no cliff
    );

    assert_eq!(result, Err(Ok(EscrowError::InvalidToken)));
}
