use anchor_lang::prelude::*;

#[account]
pub struct MatchEscrow {
    /// Unique match identifier (matches frontend-generated ID)
    pub match_id: [u8; 32],
    /// Player 1 wallet
    pub player_one: Pubkey,
    /// Player 2 wallet (set when P2 joins)
    pub player_two: Pubkey,
    /// Amount each player staked (in lamports for SOL, token units for USDC)
    pub stake_amount: u64,
    /// true = SOL stakes, false = USDC SPL token
    pub is_sol: bool,
    /// Current escrow status
    pub status: EscrowStatus,
    /// When match was created (unix timestamp)
    pub created_at: i64,
    /// Fee basis points (250 = 2.5%)
    pub fee_bps: u16,
    /// Treasury fee receiver
    pub treasury: Pubkey,
    /// PDA bump
    pub bump: u8,
    /// Vault bump (for SPL token vault)
    pub vault_bump: u8,
}

impl MatchEscrow {
    pub const LEN: usize = 8   // discriminator
        + 32  // match_id
        + 32  // player_one
        + 32  // player_two
        + 8   // stake_amount
        + 1   // is_sol
        + 1   // status
        + 8   // created_at
        + 2   // fee_bps
        + 32  // treasury
        + 1   // bump
        + 1;  // vault_bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EscrowStatus {
    /// P1 deposited, waiting for P2
    WaitingForPlayer2,
    /// Both players deposited, game active
    Active,
    /// Match resolved, winner paid
    Resolved,
    /// Match cancelled, players refunded
    Cancelled,
}
