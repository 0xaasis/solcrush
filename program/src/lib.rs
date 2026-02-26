use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("REPLACE_AFTER_DEPLOY");

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::*;

/// SolCrush On-Chain Staking Program
/// Handles SOL and USDC escrow for PvP match-3 wagering
///
/// Fee: 2.5% (250 basis points) deducted from prize pool on settlement
/// Escrow: PDA seeds ["escrow", match_id] holds funds until resolved

#[program]
pub mod solcrush_staking {
    use super::*;

    /// P1 creates the escrow and deposits their stake.
    /// match_id: unique 32-byte identifier generated on frontend
    /// stake_amount: lamports (SOL) or token units (USDC with 6 decimals)
    /// is_sol: true = SOL stake, false = USDC stake
    pub fn initialize_match(
        ctx: Context<InitializeMatch>,
        match_id: [u8; 32],
        stake_amount: u64,
        is_sol: bool,
    ) -> Result<()> {
        instructions::initialize_match::handler(ctx, match_id, stake_amount, is_sol)
    }

    /// P2 deposits their matching stake into the escrow
    pub fn deposit_stake(ctx: Context<DepositStake>) -> Result<()> {
        instructions::deposit_stake::handler(ctx)
    }

    /// Called by winner (or authority) to pay out escrow - 2.5% fee to treasury
    pub fn resolve_match(ctx: Context<ResolveMatch>, winner: Pubkey) -> Result<()> {
        instructions::resolve_match::handler(ctx, winner)
    }

    /// Refunds both players, called on timeout or disconnect
    pub fn cancel_match(ctx: Context<CancelMatch>) -> Result<()> {
        instructions::cancel_match::handler(ctx)
    }
}
