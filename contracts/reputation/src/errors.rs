use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ReputationError {
    /// Caller is not an authorized operator
    Unauthorized = 1,
    /// Zero points award attempted
    InvalidPoints = 2,
    /// Contributor profile not found
    NotFound = 3,
    /// Contract already initialized
    AlreadyInitialized = 4,
}
