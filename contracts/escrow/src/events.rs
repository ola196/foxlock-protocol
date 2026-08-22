//! Contract events.
//!
//! All state-changing operations emit events so off-chain indexers
//! (like the GrantFox webhook service) can track escrow activity.

#![allow(deprecated)]

use soroban_sdk::{symbol_short, Address, Env};

pub fn escrow_created(env: &Env, escrow_id: u64, client: &Address, contributor: &Address) {
    env.events().publish(
        (symbol_short!("CREATED"), escrow_id),
        (client.clone(), contributor.clone()),
    );
}

pub fn milestone_submitted(env: &Env, escrow_id: u64, milestone_index: u32) {
    env.events().publish(
        (symbol_short!("SUBMIT"), escrow_id),
        milestone_index,
    );
}

pub fn milestone_approved(env: &Env, escrow_id: u64, milestone_index: u32, amount: i128) {
    env.events().publish(
        (symbol_short!("APPROVE"), escrow_id),
        (milestone_index, amount),
    );
}

pub fn milestone_rejected(env: &Env, escrow_id: u64, milestone_index: u32) {
    env.events().publish(
        (symbol_short!("REJECT"), escrow_id),
        milestone_index,
    );
}

pub fn dispute_raised(env: &Env, escrow_id: u64, raised_by: &Address) {
    env.events().publish(
        (symbol_short!("DISPUTE"), escrow_id),
        raised_by.clone(),
    );
}

pub fn dispute_resolved(
    env: &Env,
    escrow_id: u64,
    client_amount: i128,
    contributor_amount: i128,
) {
    env.events().publish(
        (symbol_short!("RESOLVE"), escrow_id),
        (client_amount, contributor_amount),
    );
}

pub fn escrow_cancelled(env: &Env, escrow_id: u64) {
    env.events().publish(
        (symbol_short!("CANCEL"), escrow_id),
        (),
    );
}

pub fn deadline_claim(env: &Env, escrow_id: u64, amount: i128) {
    env.events().publish(
        (symbol_short!("DLCLAIM"), escrow_id),
        amount,
    );
}

pub fn deadline_proposed(env: &Env, escrow_id: u64, proposed_by: &Address, new_deadline: u32) {
    env.events().publish(
        (symbol_short!("DLPROP"), escrow_id),
        (proposed_by.clone(), new_deadline),
    );
}

pub fn deadline_extended(env: &Env, escrow_id: u64, old_deadline: u32, new_deadline: u32) {
    env.events().publish(
        (symbol_short!("DLEXT"), escrow_id),
        (old_deadline, new_deadline),
    );
}
