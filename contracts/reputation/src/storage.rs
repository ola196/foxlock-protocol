use soroban_sdk::{Address, Env};
use crate::types::ContributorProfile;

const TTL: u32 = 30 * 24 * 60 * 12; // ~30 days

/// Retrieve a contributor's profile.
pub fn get_profile(env: &Env, contributor: &Address) -> Option<ContributorProfile> {
    env.storage()
        .persistent()
        .get(&(soroban_sdk::symbol_short!("PROFILE"), contributor.clone()))
}

/// Persist a contributor's profile with TTL bump.
pub fn set_profile(env: &Env, contributor: &Address, profile: &ContributorProfile) {
    let key = (soroban_sdk::symbol_short!("PROFILE"), contributor.clone());
    env.storage().persistent().set(&key, profile);
    env.storage().persistent().extend_ttl(&key, TTL, TTL);
}

/// Get the authorized operator address.
pub fn get_operator(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get(&soroban_sdk::symbol_short!("OPERATOR"))
}

/// Set the authorized operator address.
pub fn set_operator(env: &Env, operator: &Address) {
    env.storage()
        .instance()
        .set(&soroban_sdk::symbol_short!("OPERATOR"), operator);
    env.storage().instance().extend_ttl(TTL, TTL);
}
