//! Shared data types for the escrow contract.

use soroban_sdk::{contracttype, Address, String, Vec};

/// Top-level status of an escrow agreement.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    /// Escrow is active; milestones can be submitted and approved.
    Active,
    /// All milestones approved; escrow complete.
    Completed,
    /// A dispute has been raised and is awaiting arbitration.
    Disputed,
    /// Escrow was cancelled; remaining funds returned to client.
    Cancelled,
}

/// Status of an individual milestone.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MilestoneStatus {
    /// Milestone defined but not yet submitted.
    Pending,
    /// Contributor has submitted proof of completion.
    Submitted,
    /// Client has approved; funds released.
    Approved,
    /// Client rejected the submission; contributor may resubmit.
    Rejected,
}

/// A single milestone within an escrow agreement.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    /// Human-readable title (e.g., "Backend API complete")
    pub title: String,
    /// Token amount allocated to this milestone (in stroops or token base units)
    pub amount: i128,
    /// Current status of this milestone
    pub status: MilestoneStatus,
    /// IPFS CID or URL pointing to proof of work (set on submission)
    pub proof_url: String,
}

/// The full escrow record stored on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowRecord {
    /// Address of the party funding the escrow (project / client)
    pub client: Address,
    /// Address of the party doing the work (contributor / service provider)
    pub contributor: Address,
    /// Trusted third party who can resolve disputes
    pub arbitrator: Address,
    /// The SEP-0041 token contract used for payment (e.g., USDC)
    pub token: Address,
    /// Total amount deposited into this escrow
    pub total_amount: i128,
    /// Amount already released to the contributor
    pub released_amount: i128,
    /// Ordered list of milestones
    pub milestones: Vec<Milestone>,
    /// Ledger number after which the contributor can claim without approval
    pub deadline_ledger: u32,
    /// Current escrow status
    pub status: EscrowStatus,
    /// Optional human-readable description
    pub description: String,
}
