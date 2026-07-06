//! Reputation contract — tracks contributor FoxPoints and tiers.

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};
use crate::{
    errors::ReputationError,
    storage,
    types::{ContributorProfile, Tier},
};

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    /// Initialize the contract with an authorized operator.
    /// Only the operator can award or deduct points.
    pub fn initialize(env: Env, operator: Address) -> Result<(), ReputationError> {
        if storage::get_operator(&env).is_some() {
            return Err(ReputationError::AlreadyInitialized);
        }
        storage::set_operator(&env, &operator);
        Ok(())
    }

    /// Award FoxPoints to a contributor after a milestone is approved.
    ///
    /// Only the registered operator (e.g., escrow contract or platform admin)
    /// can call this to prevent gaming.
    pub fn award_points(
        env: Env,
        operator: Address,
        contributor: Address,
        points: u64,
    ) -> Result<ContributorProfile, ReputationError> {
        operator.require_auth();

        let registered = storage::get_operator(&env).ok_or(ReputationError::Unauthorized)?;
        if operator != registered {
            return Err(ReputationError::Unauthorized);
        }
        if points == 0 {
            return Err(ReputationError::InvalidPoints);
        }

        let mut profile = storage::get_profile(&env, &contributor)
            .unwrap_or(ContributorProfile {
                fox_points: 0,
                milestones_completed: 0,
                milestones_rejected: 0,
                tier: Tier::Cub,
                last_updated: 0,
            });

        profile.fox_points = profile.fox_points.saturating_add(points);
        profile.milestones_completed = profile.milestones_completed.saturating_add(1);
        profile.tier = Tier::from_points(profile.fox_points);
        profile.last_updated = env.ledger().sequence();

        storage::set_profile(&env, &contributor, &profile);

        // Emit points awarded event
        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("POINTS"), contributor.clone()),
            (points, profile.tier.clone()),
        );

        Ok(profile)
    }

    /// Record a rejected milestone (quality signal, no points deducted).
    pub fn record_rejection(
        env: Env,
        operator: Address,
        contributor: Address,
    ) -> Result<(), ReputationError> {
        operator.require_auth();

        let registered = storage::get_operator(&env).ok_or(ReputationError::Unauthorized)?;
        if operator != registered {
            return Err(ReputationError::Unauthorized);
        }

        let mut profile = storage::get_profile(&env, &contributor)
            .unwrap_or(ContributorProfile {
                fox_points: 0,
                milestones_completed: 0,
                milestones_rejected: 0,
                tier: Tier::Cub,
                last_updated: 0,
            });

        profile.milestones_rejected = profile.milestones_rejected.saturating_add(1);
        profile.last_updated = env.ledger().sequence();
        storage::set_profile(&env, &contributor, &profile);

        Ok(())
    }

    /// Transfer the operator role to a new address.
    pub fn transfer_operator(
        env: Env,
        current_operator: Address,
        new_operator: Address,
    ) -> Result<(), ReputationError> {
        current_operator.require_auth();

        let registered = storage::get_operator(&env).ok_or(ReputationError::Unauthorized)?;
        if current_operator != registered {
            return Err(ReputationError::Unauthorized);
        }

        storage::set_operator(&env, &new_operator);
        Ok(())
    }

    // ── Read-only ────────────────────────────────────────────────────────────

    /// Get a contributor's full profile.
    pub fn get_profile(
        env: Env,
        contributor: Address,
    ) -> Result<ContributorProfile, ReputationError> {
        storage::get_profile(&env, &contributor).ok_or(ReputationError::NotFound)
    }

    /// Get just the tier for a contributor (cheap read for UI).
    pub fn get_tier(env: Env, contributor: Address) -> Tier {
        storage::get_profile(&env, &contributor)
            .map(|p| p.tier)
            .unwrap_or(Tier::Cub)
    }

    /// Get the current authorized operator.
    pub fn get_operator(env: Env) -> Option<Address> {
        storage::get_operator(&env)
    }
}
