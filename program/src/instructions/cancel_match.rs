use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, CloseAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::{MatchEscrow, EscrowStatus};
use crate::errors::SolCrushError;

/// Cancel timeout: 10 minutes after creation with no P2
pub const CANCEL_TIMEOUT: i64 = 600;

pub fn handler(ctx: Context<CancelMatch>) -> Result<()> {
    let escrow = &mut ctx.accounts.match_escrow;

    require!(
        escrow.status != EscrowStatus::Resolved,
        SolCrushError::AlreadyResolved
    );

    let caller = ctx.accounts.caller.key();

    // If only P1 has joined (WaitingForPlayer2), P1 can cancel anytime
    // If Active, either player can cancel after timeout
    if escrow.status == EscrowStatus::Active {
        require!(
            caller == escrow.player_one || caller == escrow.player_two,
            SolCrushError::NotAParticipant
        );
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= escrow.created_at + CANCEL_TIMEOUT,
            SolCrushError::NotTimedOut
        );
    } else {
        // WaitingForPlayer2 — only P1 can cancel
        require!(caller == escrow.player_one, SolCrushError::NotAParticipant);
    }

    let stake = escrow.stake_amount;
    let match_id = escrow.match_id;
    let bump = escrow.bump;
    let is_active = escrow.status == EscrowStatus::Active;

    escrow.status = EscrowStatus::Cancelled;

    if escrow.is_sol {
        let escrow_info = escrow.to_account_info();
        let p1_info = ctx.accounts.player_one.to_account_info();

        // Refund P1
        **escrow_info.try_borrow_mut_lamports()? -= stake;
        **p1_info.try_borrow_mut_lamports()? += stake;

        // Refund P2 only if they deposited
        if is_active {
            let p2_info = ctx.accounts.player_two.to_account_info();
            **escrow_info.try_borrow_mut_lamports()? -= stake;
            **p2_info.try_borrow_mut_lamports()? += stake;
        }
    } else {
        let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", &match_id, &[bump]]];

        // Refund P1 USDC
        let cpi_p1 = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.player_one_ata.to_account_info(),
                authority: ctx.accounts.match_escrow.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_p1, stake)?;

        // Refund P2 USDC only if they deposited
        if is_active {
            let cpi_p2 = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.player_two_ata.to_account_info(),
                    authority: ctx.accounts.match_escrow.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(cpi_p2, stake)?;
        }

        // Close vault
        let cpi_close = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.player_one.to_account_info(),
                authority: ctx.accounts.match_escrow.to_account_info(),
            },
            signer_seeds,
        );
        token::close_account(cpi_close)?;
    }

    msg!("Match {} cancelled. Players refunded.", hex::encode(&match_id[..8]));
    Ok(())
}

#[derive(Accounts)]
pub struct CancelMatch<'info> {
    #[account(
        mut,
        seeds = [b"escrow", &match_escrow.match_id],
        bump = match_escrow.bump,
    )]
    pub match_escrow: Account<'info, MatchEscrow>,

    #[account(mut, seeds = [b"vault", &match_escrow.match_id], bump = match_escrow.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,

    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(mut, address = match_escrow.player_one)]
    pub player_one: SystemAccount<'info>,

    /// CHECK: Only used when status is Active
    #[account(mut)]
    pub player_two: AccountInfo<'info>,

    #[account(mut, associated_token::mint = token_mint, associated_token::authority = player_one)]
    pub player_one_ata: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = token_mint, associated_token::authority = player_two)]
    pub player_two_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
