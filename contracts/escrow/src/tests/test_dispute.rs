//! Tests for dispute raise and resolution.

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use crate::errors::EscrowError;
use crate::types::EscrowStatus;
use super::helpers::*;

#[test]
fn test_dispute_resolution_split() {
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
            &String::from_str(&env, "Dispute test"),
        );

    // Client raises dispute
    escrow.raise_dispute(&client_addr, &id);

    let record = escrow.get_escrow(&id);
    assert_eq!(record.status, EscrowStatus::Disputed);

    // Arbitrator splits 600/400
    escrow.resolve_dispute(&arbitrator_addr, &id, &600i128, &400i128);

    assert_eq!(balance(&env, &token_addr, &client_addr), 600);
    assert_eq!(balance(&env, &token_addr, &contributor_addr), 400);

    let record = escrow.get_escrow(&id);
    assert_eq!(record.status, EscrowStatus::Completed);
}

#[test]
fn test_dispute_resolution_wrong_amount() {
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
            &String::from_str(&env, "Wrong split"),
        );

    escrow.raise_dispute(&contributor_addr, &id);

    // Amounts don't sum to 1000
    let result = escrow.try_resolve_dispute(&arbitrator_addr, &id, &500i128, &400i128);
    assert_eq!(result, Err(Ok(EscrowError::AmountMismatch)));
}

#[test]
fn test_non_arbitrator_cannot_resolve() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let arbitrator_addr = Address::generate(&env);
    let impostor = Address::generate(&env);
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
            &String::from_str(&env, "Auth dispute"),
        );

    escrow.raise_dispute(&client_addr, &id);

    let result = escrow.try_resolve_dispute(&impostor, &id, &500i128, &500i128);
    assert_eq!(result, Err(Ok(EscrowError::Unauthorized)));
}

#[test]
fn test_third_party_cannot_raise_dispute() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let outsider = Address::generate(&env);
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
            &String::from_str(&env, "Outsider test"),
        );

    let result = escrow.try_raise_dispute(&outsider, &id);
    assert_eq!(result, Err(Ok(EscrowError::Unauthorized)));
}
