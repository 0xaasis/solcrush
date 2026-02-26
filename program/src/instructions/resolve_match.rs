use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, CloseAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::{MatchEscrow, EscrowStatus};
use crate::errors::SolCrushError;

pub fn handler(ctx: Context<ResolveMatch>, winner: Pubkey) -> Result<()> {
    let escrow = &mut ctx.accounts.match_escrow;

    require!(escrow.status == EscrowStatus::Active, SolCrushError::MatchNotActive);

    // Winner must be one of the two players
    require!(
        winner == escrow.player_one || winner == escrow.player_two,
        SolCrushError::InvalidWinner
    );

    // Caller must be one of the two players
    let caller = ctx.accounts.caller.key();
    require!(
        caller == escrow.player_one || caller == escrow.player_two,
        SolCrushError::NotAParticipant
    );

    let total_pool = escrow.stake_amount
        .checked_mul(2)
        .ok_or(SolCrushError::Overflow)?;

    // fee = total_pool * 250 / 10000 = 2.5%
    let fee = total_pool
        .checked_mul(escrow.fee_bps as u64)
        .ok_or(SolCrushError::Overflow)?
        .checked_div(10_000)
        .ok_or(SolCrushError::Overflow)?;

    let winner_amount = total_pool
        .checked_sub(fee)
        .ok_or(SolCrushError::Overflow)?;

    let match_id = escrow.match_id;
    let bump = escrow.bump;
    let escrow_seeds: &[&[u8]] = &[b"escrow", &match_id, &[bump]];

    if escrow.is_sol {
        // ── SOL payout ─────────────────────────────────────────────────────
        let escrow_info = escrow.to_account_info();
        let winner_info = if winner == escrow.player_one {
            ctx.accounts.player_one.to_account_info()
        } else {
            ctx.accounts.player_two.to_account_info()
        };
        let treasury_info = ctx.accounts.treasury.to_account_info();

        // Transfer to winner
        **escrow_info.try_borrow_mut_lamports()? = escrow_info
            .lamports()
            .checked_sub(winner_amount)
            .ok_or(SolCrushError::Overflow)?;
        **winner_info.try_borrow_mut_lamports()? = winner_info
            .lamports()
            .checked_add(winner_amount)
            .ok_or(SolCrushError::Overflow)?;

        // Transfer fee to treasury
        **escrow_info.try_borrow_mut_lamports()? = escrow_info
            .lamports()
            .checked_sub(fee)
            .ok_or(SolCrushError::Overflow)?;
        **treasury_info.try_borrow_mut_lamports()? = treasury_info
            .lamports()
            .checked_add(fee)
            .ok_or(SolCrushError::Overflow)?;
    } else {
        // ── USDC SPL token payout ───────────────────────────────────────────
        let signer_seeds = &[escrow_seeds];

        let winner_ata = if winner == escrow.player_one {
            ctx.accounts.player_one_ata.to_account_info()
        } else {
            ctx.accounts.player_two_ata.to_account_info()
        };

        // Transfer to winner
        let cpi_winner = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: winner_ata,
                authority: ctx.accounts.match_escrow.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_winner, winner_amount)?;

        // Transfer fee to treasury ATA
        let cpi_fee = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.treasury_ata.to_account_info(),
                authority: ctx.accounts.match_escrow.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_fee, fee)?;

        // Close vault, return rent to P1
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

    escrow.status = EscrowStatus::Resolved;

    msg!(
        "Match {} resolved. Winner: {}. Payout: {}. Fee: {}.",
        hex::encode(&match_id[..8]),
        winner,
        winner_amount,
        fee
    );

    Ok(())
}

#[derive(Accounts)]
pub struct ResolveMatch<'info> {
    #[account(
        mut,
        seeds = [b"escrow", &match_escrow.match_id],
        bump = match_escrow.bump,
    )]
    pub match_escrow: Account<'info, MatchEscrow>,

    #[account(mut, seeds = [b"vault", &match_escrow.match_id], bump = match_escrow.vault_bump)]
    pub vault: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,

    /// The player calling resolve (must be P1 or P2)
    #[account(mut)]
    pub caller: Signer<'info>,

    /// P1 wallet (receives rent or winnings)
    #[account(mut, address = match_escrow.player_one)]
    pub player_one: SystemAccount<'info>,

    /// P2 wallet
    #[account(mut, address = match_escrow.player_two)]
    pub player_two: SystemAccount<'info>,

    /// P1 token ATA
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = player_one,
    )]
    pub player_one_ata: Account<'info, TokenAccount>,

    /// P2 token ATA
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = player_two,
    )]
    pub player_two_ata: Account<'info, TokenAccount>,

    /// Treasury wallet (fee receiver)
    #[account(mut, address = match_escrow.treasury)]
    pub treasury: SystemAccount<'info>,

    /// Treasury ATA for USDC fees
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
