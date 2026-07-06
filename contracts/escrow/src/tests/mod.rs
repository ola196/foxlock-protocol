//! Test suite for the Milestone Escrow contract.
//!
//! Uses Soroban's built-in test environment for full in-process simulation.

mod test_create;
mod test_milestones;
mod test_dispute;
mod test_cancel;
mod test_deadline;

/// Shared test helpers used across all test modules.
pub mod helpers {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{StellarAssetClient, TokenClient},
        Address, Env, String, Vec,
    };
    use crate::{EscrowContract, EscrowContractClient};
    use crate::types::{Milestone, MilestoneStatus};

    /// Deploy the escrow contract and return a client.
    pub fn deploy_escrow(env: &Env) -> EscrowContractClient {
        let contract_id = env.register(EscrowContract, ());
        EscrowContractClient::new(env, &contract_id)
    }

    /// Deploy a mock SAC token and fund accounts.
    pub fn deploy_token(env: &Env, admin: &Address) -> (Address, StellarAssetClient) {
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = StellarAssetClient::new(env, &token_id.address());
        (token_id.address(), sac)
    }

    /// Mint tokens to an address.
    pub fn mint(env: &Env, sac: &StellarAssetClient, to: &Address, amount: i128) {
        sac.mint(to, &amount);
    }

    /// Get token balance of an address.
    pub fn balance(env: &Env, token: &Address, of: &Address) -> i128 {
        TokenClient::new(env, token).balance(of)
    }

    /// Build a simple 2-milestone Vec.
    pub fn two_milestones(env: &Env) -> Vec<Milestone> {
        let mut v = Vec::new(env);
        v.push_back(Milestone {
            title: String::from_str(env, "Design"),
            amount: 500,
            status: MilestoneStatus::Pending,
            proof_url: String::from_str(env, ""),
        });
        v.push_back(Milestone {
            title: String::from_str(env, "Implementation"),
            amount: 500,
            status: MilestoneStatus::Pending,
            proof_url: String::from_str(env, ""),
        });
        v
    }

    /// Advance the ledger sequence by n.
    pub fn advance_ledger(env: &Env, n: u32) {
        env.ledger().with_mut(|li| li.sequence_number += n);
    }
}
