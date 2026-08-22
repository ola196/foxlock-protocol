//! Milestone Escrow Contract — core logic.
//!
//! Security invariants enforced throughout:
//! - All addresses that authorize spending MUST call `require_auth()`.
//! - Amounts are validated before token transfers.
//! - Milestone amounts are validated to sum to total_amount on creation.
//! - Re-entrancy is not possible in Soroban (single-threaded WASM).
//! - Max 20 milestones per escrow to prevent DoS via large Vec iteration.

use soroban_sdk::{contract, contractimpl, token, Address, Env, String, Vec};

use crate::{
    errors::EscrowError,
    events,
    storage,
    types::{DeadlineProposal, EscrowRecord, EscrowStatus, Milestone, MilestoneStatus},
};

/// Maximum milestones per escrow — prevents storage bloat and DoS.
const MAX_MILESTONES: u32 = 20;

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Create a new escrow agreement.
    ///
    /// The caller (client) must authorize this call. Funds are transferred
    /// from the client's account into the contract immediately.
    ///
    /// # Arguments
    /// * `client`          – Funder of the escrow (project owner)
    /// * `contributor`     – Worker who will complete milestones
    /// * `arbitrator`      – Trusted resolver in case of dispute
    /// * `token`           – SEP-0041 token contract address (e.g. USDC)
    /// * `milestones`      – Ordered list of milestones with amounts
    /// * `deadline_ledger` – Ledger number after which contributor can claim
    /// * `description`     – Human-readable context for this escrow
    /// * `cliff_ledger`    – Earliest ledger at which milestones may be submitted.
    ///                       Pass 0 to disable (no cliff restriction).
    ///                       Must be strictly less than `deadline_ledger` when non-zero.
    ///
    /// Returns the new escrow ID.
    pub fn create_escrow(
        env: Env,
        client: Address,
        contributor: Address,
        arbitrator: Address,
        token: Address,
        milestones: Vec<Milestone>,
        deadline_ledger: u32,
        description: String,
        cliff_ledger: u32,
    ) -> Result<u64, EscrowError> {
        // Authorization: client must sign this transaction
        client.require_auth();

        // Validation
        if milestones.is_empty() {
            return Err(EscrowError::EmptyMilestones);
        }
        if milestones.len() > MAX_MILESTONES {
            return Err(EscrowError::TooManyMilestones);
        }
        if deadline_ledger <= env.ledger().sequence() {
            return Err(EscrowError::InvalidDeadline);
        }
        // Cliff, when set, must be strictly before the deadline so the window
        // [cliff, deadline) is non-empty and the contributor has time to work.
        if cliff_ledger != 0 && cliff_ledger >= deadline_ledger {
            return Err(EscrowError::InvalidDeadline);
        }

        // Compute and validate total amount from milestone amounts
        let mut total_amount: i128 = 0;
        for i in 0..milestones.len() {
            let m = milestones.get(i).unwrap();
            if m.amount <= 0 {
                return Err(EscrowError::InvalidAmount);
            }
            // Validate each milestone starts in Pending status
            if m.status != MilestoneStatus::Pending {
                return Err(EscrowError::InvalidMilestoneStatus);
            }
            total_amount = total_amount
                .checked_add(m.amount)
                .ok_or(EscrowError::InvalidAmount)?;
        }

        // Validate that `token` implements the SEP-0041 interface by probing
        // `decimals()`. A non-token contract will return an error here, which
        // we convert to InvalidToken before any funds move.
        //
        // `try_decimals()` returns `Result<Result<u32, _>, Result<_, _>>`:
        //   outer Err  → host/invoke failure (contract doesn't exist or lacks the fn)
        //   inner Err  → return-value conversion failure (shouldn't happen for u32)
        // Both cases indicate the address is not a valid SEP-0041 token.
        let token_client = token::TokenClient::new(&env, &token);
        match token_client.try_decimals() {
            Ok(Ok(_)) => {} // valid SEP-0041 token
            _ => return Err(EscrowError::InvalidToken),
        }

        // Transfer total funds from client to this contract
        token_client.transfer(&client, &env.current_contract_address(), &total_amount);

        // Generate new escrow ID
        let escrow_id = storage::increment_counter(&env);

        // Persist the escrow record
        let record = EscrowRecord {
            client: client.clone(),
            contributor: contributor.clone(),
            arbitrator,
            token,
            total_amount,
            released_amount: 0,
            milestones,
            deadline_ledger,
            status: EscrowStatus::Active,
            description,
            cliff_ledger,
        };
        storage::set_escrow(&env, escrow_id, &record);

        // Emit creation event for off-chain indexers
        events::escrow_created(&env, escrow_id, &client, &contributor);

        Ok(escrow_id)
    }

    /// Contributor submits proof of completion for a milestone.
    ///
    /// # Arguments
    /// * `contributor`       – Must match the escrow's contributor
    /// * `escrow_id`         – Target escrow
    /// * `milestone_index`   – Zero-based index of the milestone
    /// * `proof_url`         – IPFS CID or URL with evidence of completion
    pub fn submit_milestone(
        env: Env,
        contributor: Address,
        escrow_id: u64,
        milestone_index: u32,
        proof_url: String,
    ) -> Result<(), EscrowError> {
        contributor.require_auth();

        let mut record = storage::get_escrow(&env, escrow_id)
            .ok_or(EscrowError::NotFound)?;

        // Only the registered contributor can submit
        if contributor != record.contributor {
            return Err(EscrowError::Unauthorized);
        }
        if record.status != EscrowStatus::Active {
            return Err(EscrowError::InvalidStatus);
        }
        // Enforce cliff: block submissions until the cliff ledger has been reached.
        // cliff_ledger == 0 means no cliff is set.
        if record.cliff_ledger != 0 && env.ledger().sequence() < record.cliff_ledger {
            return Err(EscrowError::CliffNotReached);
        }
        if milestone_index >= record.milestones.len() {
            return Err(EscrowError::InvalidMilestone);
        }

        let mut milestone = record.milestones.get(milestone_index).unwrap();
        if milestone.status != MilestoneStatus::Pending
            && milestone.status != MilestoneStatus::Rejected
        {
            return Err(EscrowError::InvalidMilestoneStatus);
        }

        // Update milestone status and proof
        milestone.status = MilestoneStatus::Submitted;
        milestone.proof_url = proof_url;
        record.milestones.set(milestone_index, milestone);
        storage::set_escrow(&env, escrow_id, &record);

        events::milestone_submitted(&env, escrow_id, milestone_index);
        Ok(())
    }

    /// Client approves a submitted milestone and releases funds.
    ///
    /// # Arguments
    /// * `client`          – Must match the escrow's client
    /// * `escrow_id`       – Target escrow
    /// * `milestone_index` – Zero-based index of the milestone to approve
    pub fn approve_milestone(
        env: Env,
        client: Address,
        escrow_id: u64,
        milestone_index: u32,
    ) -> Result<(), EscrowError> {
        client.require_auth();

        let mut record = storage::get_escrow(&env, escrow_id)
            .ok_or(EscrowError::NotFound)?;

        if client != record.client {
            return Err(EscrowError::Unauthorized);
        }
        if record.status != EscrowStatus::Active {
            return Err(EscrowError::InvalidStatus);
        }
        if milestone_index >= record.milestones.len() {
            return Err(EscrowError::InvalidMilestone);
        }

        let mut milestone = record.milestones.get(milestone_index).unwrap();
        if milestone.status != MilestoneStatus::Submitted {
            return Err(EscrowError::InvalidMilestoneStatus);
        }

        let release_amount = milestone.amount;

        // Mark milestone approved
        milestone.status = MilestoneStatus::Approved;
        record.milestones.set(milestone_index, milestone);
        record.released_amount = record
            .released_amount
            .checked_add(release_amount)
            .ok_or(EscrowError::InvalidAmount)?;

        // Check if all milestones are now approved
        let all_approved = (0..record.milestones.len()).all(|i| {
            record.milestones.get(i).unwrap().status == MilestoneStatus::Approved
        });
        if all_approved {
            record.status = EscrowStatus::Completed;
        }

        storage::set_escrow(&env, escrow_id, &record);

        // Release funds to contributor
        let token_client = token::TokenClient::new(&env, &record.token);
        token_client.transfer(
            &env.current_contract_address(),
            &record.contributor,
            &release_amount,
        );

        events::milestone_approved(&env, escrow_id, milestone_index, release_amount);
        Ok(())
    }

    /// Client rejects a submitted milestone (contributor must resubmit).
    pub fn reject_milestone(
        env: Env,
        client: Address,
        escrow_id: u64,
        milestone_index: u32,
    ) -> Result<(), EscrowError> {
        client.require_auth();

        let mut record = storage::get_escrow(&env, escrow_id)
            .ok_or(EscrowError::NotFound)?;

        if client != record.client {
            return Err(EscrowError::Unauthorized);
        }
        if record.status != EscrowStatus::Active {
            return Err(EscrowError::InvalidStatus);
        }
        if milestone_index >= record.milestones.len() {
            return Err(EscrowError::InvalidMilestone);
        }

        let mut milestone = record.milestones.get(milestone_index).unwrap();
        if milestone.status != MilestoneStatus::Submitted {
            return Err(EscrowError::InvalidMilestoneStatus);
        }

        milestone.status = MilestoneStatus::Rejected;
        record.milestones.set(milestone_index, milestone);
        storage::set_escrow(&env, escrow_id, &record);

        events::milestone_rejected(&env, escrow_id, milestone_index);
        Ok(())
    }

    /// Either party can raise a dispute, freezing the escrow.
    pub fn raise_dispute(
        env: Env,
        caller: Address,
        escrow_id: u64,
    ) -> Result<(), EscrowError> {
        caller.require_auth();

        let mut record = storage::get_escrow(&env, escrow_id)
            .ok_or(EscrowError::NotFound)?;

        // Only client or contributor may raise a dispute
        if caller != record.client && caller != record.contributor {
            return Err(EscrowError::Unauthorized);
        }
        if record.status != EscrowStatus::Active {
            return Err(EscrowError::InvalidStatus);
        }

        record.status = EscrowStatus::Disputed;
        storage::set_escrow(&env, escrow_id, &record);

        events::dispute_raised(&env, escrow_id, &caller);
        Ok(())
    }

    /// Arbitrator resolves a dispute by splitting remaining funds.
    ///
    /// # Arguments
    /// * `arbitrator`          – Must match escrow's arbitrator
    /// * `escrow_id`           – Target escrow
    /// * `client_amount`       – Amount to return to the client
    /// * `contributor_amount`  – Amount to release to the contributor
    ///
    /// `client_amount + contributor_amount` must equal the unreleased balance.
    pub fn resolve_dispute(
        env: Env,
        arbitrator: Address,
        escrow_id: u64,
        client_amount: i128,
        contributor_amount: i128,
    ) -> Result<(), EscrowError> {
        arbitrator.require_auth();

        let mut record = storage::get_escrow(&env, escrow_id)
            .ok_or(EscrowError::NotFound)?;

        if arbitrator != record.arbitrator {
            return Err(EscrowError::Unauthorized);
        }
        if record.status != EscrowStatus::Disputed {
            return Err(EscrowError::InvalidStatus);
        }

        let remaining = record
            .total_amount
            .checked_sub(record.released_amount)
            .ok_or(EscrowError::InvalidAmount)?;

        let split_total = client_amount
            .checked_add(contributor_amount)
            .ok_or(EscrowError::InvalidAmount)?;

        if split_total != remaining {
            return Err(EscrowError::AmountMismatch);
        }

        record.status = EscrowStatus::Completed;
        storage::set_escrow(&env, escrow_id, &record);

        let token_client = token::TokenClient::new(&env, &record.token);

        if client_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &record.client,
                &client_amount,
            );
        }
        if contributor_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &record.contributor,
                &contributor_amount,
            );
        }

        events::dispute_resolved(&env, escrow_id, client_amount, contributor_amount);
        Ok(())
    }

    /// Client cancels the escrow before any milestones are submitted.
    /// All funds are returned to the client.
    pub fn cancel_escrow(
        env: Env,
        client: Address,
        escrow_id: u64,
    ) -> Result<(), EscrowError> {
        client.require_auth();

        let mut record = storage::get_escrow(&env, escrow_id)
            .ok_or(EscrowError::NotFound)?;

        if client != record.client {
            return Err(EscrowError::Unauthorized);
        }
        if record.status != EscrowStatus::Active {
            return Err(EscrowError::InvalidStatus);
        }

        // Only allow cancellation if no milestones have been submitted or approved
        let has_progress = (0..record.milestones.len()).any(|i| {
            let s = record.milestones.get(i).unwrap().status.clone();
            s == MilestoneStatus::Submitted || s == MilestoneStatus::Approved
        });
        if has_progress {
            return Err(EscrowError::InvalidStatus);
        }

        let refund_amount = record
            .total_amount
            .checked_sub(record.released_amount)
            .ok_or(EscrowError::InvalidAmount)?;

        record.status = EscrowStatus::Cancelled;
        storage::set_escrow(&env, escrow_id, &record);

        let token_client = token::TokenClient::new(&env, &record.token);
        token_client.transfer(
            &env.current_contract_address(),
            &record.client,
            &refund_amount,
        );

        events::escrow_cancelled(&env, escrow_id);
        Ok(())
    }

    /// Contributor claims remaining funds after the deadline has passed.
    /// This prevents funds from being locked forever if the client goes inactive.
    pub fn claim_after_deadline(
        env: Env,
        contributor: Address,
        escrow_id: u64,
    ) -> Result<(), EscrowError> {
        contributor.require_auth();

        let mut record = storage::get_escrow(&env, escrow_id)
            .ok_or(EscrowError::NotFound)?;

        if contributor != record.contributor {
            return Err(EscrowError::Unauthorized);
        }
        if record.status != EscrowStatus::Active {
            return Err(EscrowError::InvalidStatus);
        }
        if env.ledger().sequence() < record.deadline_ledger {
            return Err(EscrowError::DeadlineNotReached);
        }

        let claimable = record
            .total_amount
            .checked_sub(record.released_amount)
            .ok_or(EscrowError::InvalidAmount)?;

        if claimable <= 0 {
            return Err(EscrowError::InvalidAmount);
        }

        record.released_amount = record.total_amount;
        record.status = EscrowStatus::Completed;
        storage::set_escrow(&env, escrow_id, &record);

        let token_client = token::TokenClient::new(&env, &record.token);
        token_client.transfer(
            &env.current_contract_address(),
            &record.contributor,
            &claimable,
        );

        events::deadline_claim(&env, escrow_id, claimable);
        Ok(())
    }

    // ── Deadline extension (mutual consent required) ─────────────────────────

    /// Propose a new deadline for an active escrow.
    ///
    /// Either the client or the contributor may open a proposal. The other
    /// party must then call `accept_deadline_extension` with the **same**
    /// `new_deadline` value to confirm. Until accepted, the on-chain deadline
    /// is not changed.
    ///
    /// Submitting a new proposal while one is already pending simply overwrites
    /// it (and resets the required counter-signature).
    ///
    /// # Arguments
    /// * `caller`        – Client or contributor (must match escrow record)
    /// * `escrow_id`     – Target escrow
    /// * `new_deadline`  – Proposed new deadline ledger number
    pub fn propose_deadline_extension(
        env: Env,
        caller: Address,
        escrow_id: u64,
        new_deadline: u32,
    ) -> Result<(), EscrowError> {
        caller.require_auth();

        let record = storage::get_escrow(&env, escrow_id)
            .ok_or(EscrowError::NotFound)?;

        // Only active escrows can have their deadline extended
        if record.status != EscrowStatus::Active {
            return Err(EscrowError::InvalidStatus);
        }

        // Only a party to the agreement can propose
        if caller != record.client && caller != record.contributor {
            return Err(EscrowError::Unauthorized);
        }

        // New deadline must be strictly later than the current deadline
        if new_deadline <= record.deadline_ledger {
            return Err(EscrowError::InvalidDeadline);
        }

        let proposal = DeadlineProposal {
            new_deadline,
            proposed_by: caller.clone(),
        };
        storage::set_deadline_proposal(&env, escrow_id, &proposal);

        events::deadline_proposed(&env, escrow_id, &caller, new_deadline);
        Ok(())
    }

    /// Accept a pending deadline extension proposal.
    ///
    /// Must be called by the **other** party (not the proposer), and the
    /// `new_deadline` supplied must match the pending proposal exactly.
    /// On success the escrow's `deadline_ledger` is updated and the proposal
    /// is removed from storage.
    ///
    /// # Arguments
    /// * `caller`        – The party accepting (must be the non-proposing party)
    /// * `escrow_id`     – Target escrow
    /// * `new_deadline`  – Must match the value in the pending proposal
    pub fn accept_deadline_extension(
        env: Env,
        caller: Address,
        escrow_id: u64,
        new_deadline: u32,
    ) -> Result<(), EscrowError> {
        caller.require_auth();

        let mut record = storage::get_escrow(&env, escrow_id)
            .ok_or(EscrowError::NotFound)?;

        if record.status != EscrowStatus::Active {
            return Err(EscrowError::InvalidStatus);
        }

        // Only a party to the agreement can accept
        if caller != record.client && caller != record.contributor {
            return Err(EscrowError::Unauthorized);
        }

        let proposal = storage::get_deadline_proposal(&env, escrow_id)
            .ok_or(EscrowError::DeadlineProposalNotFound)?;

        // The acceptor must be the opposite party from the proposer
        if caller == proposal.proposed_by {
            return Err(EscrowError::Unauthorized);
        }

        // The accepted value must match exactly — prevents bait-and-switch
        if new_deadline != proposal.new_deadline {
            return Err(EscrowError::DeadlineProposalMismatch);
        }

        let old_deadline = record.deadline_ledger;
        record.deadline_ledger = new_deadline;
        storage::set_escrow(&env, escrow_id, &record);

        // Proposal consumed — remove it so it cannot be replayed
        storage::remove_deadline_proposal(&env, escrow_id);

        events::deadline_extended(&env, escrow_id, old_deadline, new_deadline);
        Ok(())
    }

    // ── Read-only queries ────────────────────────────────────────────────────

    /// Returns the full escrow record for a given ID.
    pub fn get_escrow(env: Env, escrow_id: u64) -> Result<EscrowRecord, EscrowError> {
        storage::get_escrow(&env, escrow_id).ok_or(EscrowError::NotFound)
    }

    /// Returns the total number of escrows created (useful for pagination).
    pub fn get_escrow_count(env: Env) -> u64 {
        storage::get_counter(&env)
    }

    /// Returns the unreleased balance for a given escrow.
    pub fn get_balance(env: Env, escrow_id: u64) -> Result<i128, EscrowError> {
        let record = storage::get_escrow(&env, escrow_id)
            .ok_or(EscrowError::NotFound)?;
        Ok(record.total_amount - record.released_amount)
    }
}
