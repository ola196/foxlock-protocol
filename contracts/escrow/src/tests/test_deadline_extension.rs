//! Tests for mutual deadline extension (propose + accept pattern).

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use crate::errors::EscrowError;
use super::helpers::*;

// ── helpers ───────────────────────────────────────────────────────────────────

/// Creates a standard active escrow and returns (escrow_client, id, client, contributor).
fn setup_escrow(env: &Env) -> (crate::EscrowContractClient, u64, Address, Address) {
    env.mock_all_auths();

    let client_addr = Address::generate(env);
    let contributor_addr = Address::generate(env);
    let admin = Address::generate(env);
    let (token_addr, sac) = deploy_token(env, &admin);
    mint(env, &sac, &client_addr, 1000);

    let deadline = env.ledger().sequence() + 1000;
    let escrow = deploy_escrow(env);
    let id = escrow.create_escrow(
        &client_addr,
        &contributor_addr,
        &Address::generate(env),
        &token_addr,
        &two_milestones(env),
        &deadline,
        &String::from_str(env, "Deadline extension test"),
    );

    (escrow, id, client_addr, contributor_addr)
}

// ── happy path ────────────────────────────────────────────────────────────────

#[test]
fn test_client_proposes_contributor_accepts() {
    let env = Env::default();
    let (escrow, id, client, contributor) = setup_escrow(&env);

    let original_deadline = escrow.get_escrow(&id).deadline_ledger;
    let new_deadline = original_deadline + 500;

    // Client proposes
    escrow.propose_deadline_extension(&client, &id, &new_deadline);

    // Deadline must NOT have changed yet
    assert_eq!(escrow.get_escrow(&id).deadline_ledger, original_deadline);

    // Contributor accepts with the same value
    escrow.accept_deadline_extension(&contributor, &id, &new_deadline);

    // Now deadline is updated
    assert_eq!(escrow.get_escrow(&id).deadline_ledger, new_deadline);
}

#[test]
fn test_contributor_proposes_client_accepts() {
    let env = Env::default();
    let (escrow, id, client, contributor) = setup_escrow(&env);

    let original_deadline = escrow.get_escrow(&id).deadline_ledger;
    let new_deadline = original_deadline + 200;

    // Contributor proposes
    escrow.propose_deadline_extension(&contributor, &id, &new_deadline);

    // Deadline unchanged
    assert_eq!(escrow.get_escrow(&id).deadline_ledger, original_deadline);

    // Client accepts
    escrow.accept_deadline_extension(&client, &id, &new_deadline);

    assert_eq!(escrow.get_escrow(&id).deadline_ledger, new_deadline);
}

#[test]
fn test_proposal_overwritten_by_new_proposal() {
    let env = Env::default();
    let (escrow, id, client, contributor) = setup_escrow(&env);

    let original_deadline = escrow.get_escrow(&id).deadline_ledger;

    // Client proposes 500 ledgers ahead
    escrow.propose_deadline_extension(&client, &id, &(original_deadline + 500));

    // Contributor counter-proposes with a different value (overrides the first)
    let revised_deadline = original_deadline + 300;
    escrow.propose_deadline_extension(&contributor, &id, &revised_deadline);

    // Client accepts the second proposal
    escrow.accept_deadline_extension(&client, &id, &revised_deadline);

    assert_eq!(escrow.get_escrow(&id).deadline_ledger, revised_deadline);
}

#[test]
fn test_proposal_consumed_after_acceptance() {
    let env = Env::default();
    let (escrow, id, client, contributor) = setup_escrow(&env);

    let new_deadline = escrow.get_escrow(&id).deadline_ledger + 100;

    escrow.propose_deadline_extension(&client, &id, &new_deadline);
    escrow.accept_deadline_extension(&contributor, &id, &new_deadline);

    // Trying to accept again must fail — proposal was removed
    let result = escrow.try_accept_deadline_extension(&client, &id, &new_deadline);
    assert_eq!(result, Err(Ok(EscrowError::DeadlineProposalNotFound)));
}

// ── rejection cases ───────────────────────────────────────────────────────────

#[test]
fn test_proposer_cannot_accept_own_proposal() {
    let env = Env::default();
    let (escrow, id, client, _contributor) = setup_escrow(&env);

    let new_deadline = escrow.get_escrow(&id).deadline_ledger + 100;
    escrow.propose_deadline_extension(&client, &id, &new_deadline);

    // Client tries to accept their own proposal
    let result = escrow.try_accept_deadline_extension(&client, &id, &new_deadline);
    assert_eq!(result, Err(Ok(EscrowError::Unauthorized)));
}

#[test]
fn test_accept_with_wrong_deadline_fails() {
    let env = Env::default();
    let (escrow, id, client, contributor) = setup_escrow(&env);

    let new_deadline = escrow.get_escrow(&id).deadline_ledger + 100;
    escrow.propose_deadline_extension(&client, &id, &new_deadline);

    // Contributor tries to accept with a different value
    let result = escrow.try_accept_deadline_extension(&contributor, &id, &(new_deadline + 999));
    assert_eq!(result, Err(Ok(EscrowError::DeadlineProposalMismatch)));

    // Original deadline is unchanged
    assert_eq!(
        escrow.get_escrow(&id).deadline_ledger,
        new_deadline - 100 // == original_deadline
    );
}

#[test]
fn test_accept_with_no_proposal_fails() {
    let env = Env::default();
    let (escrow, id, _client, contributor) = setup_escrow(&env);

    let result = escrow.try_accept_deadline_extension(&contributor, &id, &9999);
    assert_eq!(result, Err(Ok(EscrowError::DeadlineProposalNotFound)));
}

#[test]
fn test_propose_deadline_not_in_future_fails() {
    let env = Env::default();
    let (escrow, id, client, _contributor) = setup_escrow(&env);

    let current_deadline = escrow.get_escrow(&id).deadline_ledger;

    // Same value as current deadline — must fail
    let result = escrow.try_propose_deadline_extension(&client, &id, &current_deadline);
    assert_eq!(result, Err(Ok(EscrowError::InvalidDeadline)));

    // Earlier than current deadline — must fail
    let result = escrow.try_propose_deadline_extension(&client, &id, &(current_deadline - 1));
    assert_eq!(result, Err(Ok(EscrowError::InvalidDeadline)));
}

#[test]
fn test_third_party_cannot_propose() {
    let env = Env::default();
    let (escrow, id, _client, _contributor) = setup_escrow(&env);

    let outsider = Address::generate(&env);
    let new_deadline = escrow.get_escrow(&id).deadline_ledger + 100;

    let result = escrow.try_propose_deadline_extension(&outsider, &id, &new_deadline);
    assert_eq!(result, Err(Ok(EscrowError::Unauthorized)));
}

#[test]
fn test_third_party_cannot_accept() {
    let env = Env::default();
    let (escrow, id, client, _contributor) = setup_escrow(&env);

    let new_deadline = escrow.get_escrow(&id).deadline_ledger + 100;
    escrow.propose_deadline_extension(&client, &id, &new_deadline);

    let outsider = Address::generate(&env);
    let result = escrow.try_accept_deadline_extension(&outsider, &id, &new_deadline);
    assert_eq!(result, Err(Ok(EscrowError::Unauthorized)));
}

#[test]
fn test_cannot_propose_on_non_active_escrow() {
    let env = Env::default();
    let (escrow, id, client, contributor) = setup_escrow(&env);

    // Cancel the escrow first
    escrow.cancel_escrow(&client, &id);

    let new_deadline = 99999u32;
    let result = escrow.try_propose_deadline_extension(&client, &id, &new_deadline);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));

    let result = escrow.try_propose_deadline_extension(&contributor, &id, &new_deadline);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_deadline_extended_allows_later_claim() {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let contributor_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_addr, sac) = deploy_token(&env, &admin);
    mint(&env, &sac, &client_addr, 1000);

    // Short initial deadline (100 ledgers away)
    let initial_deadline = env.ledger().sequence() + 100;
    let escrow = deploy_escrow(&env);
    let id = escrow.create_escrow(
        &client_addr,
        &contributor_addr,
        &Address::generate(&env),
        &token_addr,
        &two_milestones(&env),
        &initial_deadline,
        &String::from_str(&env, "Short deadline"),
    );

    // Advance past initial deadline but not past the extended one
    advance_ledger(&env, 101);

    // Extend the deadline mutually (to current + 500)
    let extended_deadline = env.ledger().sequence() + 500;
    escrow.propose_deadline_extension(&client_addr, &id, &extended_deadline);
    escrow.accept_deadline_extension(&contributor_addr, &id, &extended_deadline);

    // Contributor cannot claim yet — deadline was pushed forward
    let result = escrow.try_claim_after_deadline(&contributor_addr, &id);
    assert_eq!(result, Err(Ok(EscrowError::DeadlineNotReached)));

    // Advance past the extended deadline
    advance_ledger(&env, 501);

    // Now the contributor can claim
    escrow.claim_after_deadline(&contributor_addr, &id);
    assert_eq!(balance(&env, &token_addr, &contributor_addr), 1000);
}
