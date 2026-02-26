use anchor_lang::prelude::*;

#[error_code]
pub enum SolCrushError {
    #[msg("Match is not waiting for player 2")]
    NotWaitingForP2,
    #[msg("Match is not in active status")]
    MatchNotActive,
    #[msg("Player is not a participant in this match")]
    NotAParticipant,
    #[msg("Winner must be one of the two players")]
    InvalidWinner,
    #[msg("Stake amount must be greater than zero")]
    ZeroStake,
    #[msg("Cannot cancel an already resolved match")]
    AlreadyResolved,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Match has not timed out yet")]
    NotTimedOut,
    #[msg("Invalid treasury account")]
    InvalidTreasury,
}
