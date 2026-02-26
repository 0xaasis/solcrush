use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::{MatchEscrow, EscrowStatus};
use crate::errors::SolCrushError;

/// Fee: 250 basis points = 2.5%
pub const FEE_BPS: u16 = 250;
/// Match timeout: 10 minutes
pub const MATCH_TIMEOUT_SECONDS: i64 = 600;

pub fn handler(
    ctx: Context<InitializeMatch>,
    match_id: [u8; 32],
    stake_amount: u64,
    is_sol: bool,
) -> Result<()> {
    require!(stake_amount > 0, SolCrushError::ZeroStake);

    let escrow = &mut ctx.accounts.match_escrow;
    let clock = Clock::get()?;

    escrow.match_id = match_id;
    escrow.player_one = ctx.accounts.player_one.key();
    escrow.player_two = Pubkey::default(); // filled when P2 joins
    escrow.stake_amount = stake_amount;
    escrow.is_sol = is_sol;
    escrow.status = EscrowStatus::WaitingForPlayer2;
    escrow.created_at = clock.unix_timestamp;
    escrow.fee_bps = FEE_BPS;
    escrow.treasury = ctx.accounts.treasury.key();
    escrow.bump = ctx.bumps.match_escrow;
    escrow.vault_bump = if is_sol { 0 } else { ctx.bumps.vault };

    if is_sol {
        // Transfer SOL from player to escrow PDA
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.player_one.key(),
            &ctx.accounts.match_escrow.key(),
            stake_amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.player_one.to_account_info(),
                ctx.accounts.match_escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    } else {
        // Transfer USDC SPL token from player to vault ATA
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player_one_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.player_one.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, stake_amount)?;
    }

    msg!(
        "Match {} created by {}. Stake: {} {}",
        hex::encode(&match_id[..8]),
        ctx.accounts.player_one.key(),
        stake_amount,
        if is_sol { "lamports" } else { "USDC" }
    );

    Ok(())
}

#[derive(Accounts)]
#[instruction(match_id: [u8; 32], stake_amount: u64, is_sol: bool)]
pub struct InitializeMatch<'info> {
    /// The escrow PDA storing match state
    #[account(
        init,
        payer = player_one,
        space = MatchEscrow::LEN,
        seeds = [b"escrow", &match_id],
        bump,
    )]
    pub match_escrow: Account<'info, MatchEscrow>,

    /// SPL token vault for USDC (only needed when is_sol = false)
    /// CHECK: Only used for USDC path; validated by ATA constraints
    #[account(
        init_if_needed,
        payer = player_one,
        token::mint = token_mint,
        token::authority = match_escrow,
        seeds = [b"vault", &match_id],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Token mint (USDC). Pass any pubkey for SOL matches (not used).
    pub token_mint: Account<'info, Mint>,

    /// P1's USDC ATA (source for USDC transfers)
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = player_one,
    )]
    pub player_one_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub player_one: Signer<'info>,

    /// Treasury wallet receiving fees
    /// CHECK: Any valid pubkey set by admin
    pub treasury: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
