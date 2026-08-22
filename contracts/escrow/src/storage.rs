//! Storage helpers.
//!
//! Centralizing all storage keys and TTL management here makes it easy
//! to audit storage usage and update TTL policies in one place.

use soroban_sdk::{Env};
use crate::types::{EscrowRecord, DeadlineProposal};

// ── Storage key types ────────────────────────────────────────────────────────

/// Key for an individual escrow record (instance storage keyed by ID).
#[derive(Clone)]
pub struct EscrowKey(pub u64);

impl soroban_sdk::IntoVal<Env, soroban_sdk::Val> for EscrowKey {
    fn into_val(&self, env: &Env) -> soroban_sdk::Val {
        (soroban_sdk::symbol_short!("ESCROW"), self.0).into_val(env)
    }
}

/// Key for the auto-increment escrow ID counter.
const COUNTER_KEY: &str = "COUNTER";

// ── TTL constants (in ledgers, ~5s per ledger on Stellar mainnet) ─────────────
/// 30 days of ledgers for persistent storage entries
pub const PERSISTENT_TTL_LEDGERS: u32 = 30 * 24 * 60 * 12; // ~518,400 ledgers

// ── Public storage API ────────────────────────────────────────────────────────

/// Retrieve an escrow record. Returns None if not found.
pub fn get_escrow(env: &Env, escrow_id: u64) -> Option<EscrowRecord> {
    env.storage()
        .persistent()
        .get(&(soroban_sdk::symbol_short!("ESCROW"), escrow_id))
}

/// Persist an escrow record and bump its TTL.
pub fn set_escrow(env: &Env, escrow_id: u64, record: &EscrowRecord) {
    let key = (soroban_sdk::symbol_short!("ESCROW"), escrow_id);
    env.storage().persistent().set(&key, record);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_LEDGERS, PERSISTENT_TTL_LEDGERS);
}

/// Check whether an escrow record exists.
pub fn escrow_exists(env: &Env, escrow_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&(soroban_sdk::symbol_short!("ESCROW"), escrow_id))
}

/// Get the current counter value (next escrow ID).
pub fn get_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&soroban_sdk::symbol_short!("COUNTER"))
        .unwrap_or(0u64)
}

/// Increment and return the new counter value.
pub fn increment_counter(env: &Env) -> u64 {
    let next = get_counter(env) + 1;
    env.storage()
        .instance()
        .set(&soroban_sdk::symbol_short!("COUNTER"), &next);
    // Bump instance TTL so the counter survives long-running escrows
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_TTL_LEDGERS, PERSISTENT_TTL_LEDGERS);
    next
}

/// Retrieve a pending deadline extension proposal for an escrow.
/// Returns None if no proposal is pending.
pub fn get_deadline_proposal(env: &Env, escrow_id: u64) -> Option<DeadlineProposal> {
    env.storage()
        .temporary()
        .get(&(soroban_sdk::symbol_short!("DLPROP"), escrow_id))
}

/// Store a pending deadline extension proposal.
///
/// Stored in temporary storage: proposals expire after 7 days if not acted on,
/// preventing stale proposals from being accepted long after they were made.
pub fn set_deadline_proposal(env: &Env, escrow_id: u64, proposal: &DeadlineProposal) {
    let key = (soroban_sdk::symbol_short!("DLPROP"), escrow_id);
    // 7 days in ledgers (~5s per ledger): 7 * 24 * 60 * 12 = 120,960
    const PROPOSAL_TTL: u32 = 120_960;
    env.storage().temporary().set(&key, proposal);
    env.storage()
        .temporary()
        .extend_ttl(&key, PROPOSAL_TTL, PROPOSAL_TTL);
}

/// Remove a pending deadline extension proposal (after acceptance or override).
pub fn remove_deadline_proposal(env: &Env, escrow_id: u64) {
    env.storage()
        .temporary()
        .remove(&(soroban_sdk::symbol_short!("DLPROP"), escrow_id));
}
