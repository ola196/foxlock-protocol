//! Data types for the reputation system.

use soroban_sdk::contracttype;

/// Contributor tier based on accumulated FoxPoints.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum Tier {
    Cub    = 0,
    Fox    = 1,
    Senior = 2,
    Elite  = 3,
}

impl Tier {
    /// Minimum FoxPoints required to reach this tier.
    pub fn min_points(&self) -> u64 {
        match self {
            Tier::Cub    => 0,
            Tier::Fox    => 100,
            Tier::Senior => 500,
            Tier::Elite  => 2000,
        }
    }

    /// Max issues allowed per campaign at this tier (0 = unlimited).
    pub fn issue_cap(&self) -> u32 {
        match self {
            Tier::Cub    => 3,
            Tier::Fox    => 5,
            Tier::Senior => 10,
            Tier::Elite  => 0, // unlimited
        }
    }

    /// Derive tier from a points total.
    pub fn from_points(points: u64) -> Self {
        if points >= Tier::Elite.min_points() {
            Tier::Elite
        } else if points >= Tier::Senior.min_points() {
            Tier::Senior
        } else if points >= Tier::Fox.min_points() {
            Tier::Fox
        } else {
            Tier::Cub
        }
    }
}

/// The on-chain profile for a single contributor.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ContributorProfile {
    /// Total FoxPoints accumulated across all contributions
    pub fox_points: u64,
    /// Number of milestones approved (accepted contributions)
    pub milestones_completed: u64,
    /// Number of milestones rejected (quality signals)
    pub milestones_rejected: u64,
    /// Derived tier — recomputed on every update
    pub tier: Tier,
    /// Ledger number of last update
    pub last_updated: u32,
}
