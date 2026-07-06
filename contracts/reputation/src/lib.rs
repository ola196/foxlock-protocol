//! On-chain Contributor Reputation Contract
//!
//! Tracks FoxPoints, tiers, and contribution counts for GrantFox contributors.
//! This contract is designed to be called by the escrow contract (or an authorized
//! platform operator) whenever a milestone is approved, providing an immutable,
//! transparent reputation ledger.
//!
//! ## Tier System
//! | Tier    | Min Points | Max Issues/Campaign | Reward Multiplier |
//! |---------|------------|---------------------|-------------------|
//! | Cub     | 0          | 3                   | 1.0x              |
//! | Fox     | 100        | 5                   | 1.2x              |
//! | Senior  | 500        | 10                  | 1.5x              |
//! | Elite   | 2000       | unlimited           | 2.0x              |

#![no_std]

mod contract;
mod types;
mod storage;
mod errors;

pub use contract::ReputationContract;
pub use errors::ReputationError;
pub use types::{ContributorProfile, Tier};

#[cfg(any(test, feature = "testutils"))]
pub use contract::ReputationContractClient;
