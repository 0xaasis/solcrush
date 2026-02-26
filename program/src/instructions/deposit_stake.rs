use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::{MatchEscrow, EscrowStatus};
use crate::errors::SolCrushError;

pub fn handler(ctx: Context<DepositStake>) -> Result<()> {
    let escrow = &mut ctx.accounts.match_escrow;

    require!(
        escrow.status == EscrowStatus::WaitingForPlayer2,
        SolCrushError::NotWaitingForP2
    );
    require!(
        ctx.accounts.player_two.key() != escrow.player_one,
        SolCrushError::NotAParticipant
    );

    // Record P2 and activate match
    escrow.player_two = ctx.accounts.player_two.key();
    escrow.status = EscrowStatus::Active;

    let stake_amount = escrow.stake_amount;
    let is_sol = escrow.is_sol;
    let match_id = escrow.match_id;

    if is_sol {
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.player_two.key(),
            &ctx.accounts.match_escrow.key(),
            stake_amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.player_two.to_account_info(),
                ctx.accounts.match_escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    } else {
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player_two_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.player_two.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, stake_amount)?;
    }

    msg!(
        "Player 2 {} joined match {}. Match is now Active.",
        ctx.accounts.player_two.key(),
        hex::encode(&match_id[..8])
    );

    Ok(())
}

#[derive(Accounts)]
pub struct DepositStake<'info> {
    #[account(
        mut,
        seeds = [b"escrow", &match_escrow.match_id],
        bump = match_escrow.bump,
    )]
    pub match_escrow: Account<'info, MatchEscrow>,

    #[account(
        mut,
        seeds = [b"vault", &match_escrow.match_id],
        bump = match_escrow.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = player_two,
    )]
    pub player_two_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub player_two: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
