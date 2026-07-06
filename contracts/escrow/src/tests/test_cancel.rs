//! Tests for escrow cancellation.

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use crate::errors::EscrowError;
use crate::types::EscrowStatus;
use super::helpers::*;

#[test]
fn test_cancel_refunds_client() {
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
            &String::from_str(&env, "Cancel test"),
        )
        .unwrap();

    assert_eq!(balance(&env, &token_addr, &client_addr), 0);

    escrow.cancel_escrow(&client_addr, &id).unwrap();

    // Funds returned in full
    assert_eq!(balance(&env, &token_addr, &client_addr), 1000);

    let record = escrow.get_escrow(&id).unwrap();
    assert_eq!(record.status, EscrowStatus::Cancelled);
}

#[test]
fn test_cancel_after_submission_fails() {
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
            &String::from_str(&env, "Cancel after submit"),
        )
        .unwrap();

    // Contributor submits milestone 0
    escrow
        .submit_milestone(
            &contributor_addr,
            &id,
            &0u32,
            &String::from_str(&env, "ipfs://proof"),
        )
        .unwrap();

    // Client should NOT be able to cancel now
    let result = escrow.try_cancel_escrow(&client_addr, &id);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_non_client_cannot_cancel() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let impostor = Address::generate(&env);
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
            &String::from_str(&env, "Non-client cancel"),
        )
        .unwrap();

    let result = escrow.try_cancel_escrow(&impostor, &id);
    assert_eq!(result, Err(Ok(EscrowError::Unauthorized)));
}
