//! Contract error codes.
//!
//! Using explicit u32 discriminants makes error codes stable across upgrades
//! and easy to match in the frontend.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    /// Escrow with this ID already exists
    AlreadyInitialized = 1,
    /// Escrow with this ID does not exist
    NotFound = 2,
    /// Caller is not authorized to perform this action
    Unauthorized = 3,
    /// Escrow is not in the required status for this action
    InvalidStatus = 4,
    /// Milestone index is out of range
    InvalidMilestone = 5,
    /// Milestone is not in the required status for this action
    InvalidMilestoneStatus = 6,
    /// Milestone amounts do not sum to the total escrow amount
    AmountMismatch = 7,
    /// Zero or negative amount provided
    InvalidAmount = 8,
    /// Deadline ledger must be in the future
    InvalidDeadline = 9,
    /// Milestone list cannot be empty
    EmptyMilestones = 10,
    /// Token transfer failed
    TransferFailed = 11,
    /// Deadline has not yet passed (for time-based claims)
    DeadlineNotReached = 12,
    /// Maximum milestone count exceeded (prevents DoS)
    TooManyMilestones = 13,
}
