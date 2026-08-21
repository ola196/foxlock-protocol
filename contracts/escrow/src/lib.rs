//! Soroban Milestone Escrow Contract
//!
//! A trustless escrow protocol for milestone-based fund release on Stellar.
//! Designed for GrantFox contributor reward disbursement and any Web3
//! collaboration platform that needs structured, auditable payments.
//!
//! ## Flow
//! 1. Client deposits funds into escrow, defining milestones.
//! 2. Service provider (contributor) completes milestones.
//! 3. Client approves each milestone → funds released incrementally.
//! 4. Either party can raise a dispute; an arbitrator resolves it.
//! 5. If deadline passes without dispute, contributor can claim.

#![no_std]

mod contract;
mod errors;
mod events;
mod storage;
mod types;

pub use contract::EscrowContract;
pub use errors::EscrowError;
pub use types::{EscrowStatus, Milestone, MilestoneStatus};

// Re-export the contract client for use in tests and frontend bindings
#[cfg(any(test, feature = "testutils"))]
pub use contract::EscrowContractClient;

#[cfg(test)]
mod tests;
