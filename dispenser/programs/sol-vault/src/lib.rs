use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6");

const MAX_BUNDLE_ACCOUNTS: usize = 16;
const NONCE_ACCOUNT_SPACE: u64 = 80;

#[program]
pub mod sol_dispenser {
    use super::*;

    /// Funds disposable wallets and creates one durable nonce account for each.
    ///
    /// Remaining accounts must be provided as repeating pairs:
    /// `[disposable_wallet signer+writable, nonce_account signer+writable]`.
    ///
    /// The nonce authority is set to the matching disposable wallet so later
    /// bundle transactions can be signed by that disposable keypair.
    pub fn fund_bundle_accounts<'info>(
        ctx: Context<'info, FundBundleAccounts<'info>>,
        disposable_amounts: Vec<u64>,
    ) -> Result<()> {
        let account_count = disposable_amounts.len();
        require!(account_count > 0, DispenserError::NoBundleAccounts);
        require!(
            account_count <= MAX_BUNDLE_ACCOUNTS,
            DispenserError::TooManyBundleAccounts
        );

        let expected_remaining = account_count
            .checked_mul(2)
            .ok_or(error!(DispenserError::ArithmeticOverflow))?;
        require!(
            ctx.remaining_accounts.len() == expected_remaining,
            DispenserError::BundleAccountMismatch
        );

        let rent = Rent::get()?;
        let nonce_rent = rent.minimum_balance(NONCE_ACCOUNT_SPACE as usize);
        let total_disposable = checked_sum(&disposable_amounts)?;
        let total_nonce_rent = nonce_rent
            .checked_mul(account_count as u64)
            .ok_or(error!(DispenserError::ArithmeticOverflow))?;
        let total_required = total_disposable
            .checked_add(total_nonce_rent)
            .ok_or(error!(DispenserError::ArithmeticOverflow))?;

        require!(
            ctx.accounts.funder.lamports() >= total_required,
            DispenserError::InsufficientFunderBalance
        );

        let mut seen_accounts = Vec::with_capacity(expected_remaining);

        for (index, pair) in ctx.remaining_accounts.chunks_exact(2).enumerate() {
            let disposable_wallet = &pair[0];
            let nonce_account = &pair[1];
            let amount = disposable_amounts[index];

            validate_disposable_wallet(disposable_wallet)?;
            validate_nonce_account(nonce_account)?;
            require!(
                disposable_wallet.key() != nonce_account.key(),
                DispenserError::DuplicateBundleAccount
            );
            require!(
                !seen_accounts.contains(&disposable_wallet.key()),
                DispenserError::DuplicateBundleAccount
            );
            require!(
                !seen_accounts.contains(&nonce_account.key()),
                DispenserError::DuplicateBundleAccount
            );
            seen_accounts.push(disposable_wallet.key());
            seen_accounts.push(nonce_account.key());

            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    system_program::Transfer {
                        from: ctx.accounts.funder.to_account_info(),
                        to: disposable_wallet.to_account_info(),
                    },
                ),
                amount,
            )?;

            system_program::create_nonce_account(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    system_program::CreateNonceAccount {
                        from: ctx.accounts.funder.to_account_info(),
                        nonce: nonce_account.to_account_info(),
                        recent_blockhashes: ctx.accounts.recent_blockhashes.to_account_info(),
                        rent: ctx.accounts.rent.to_account_info(),
                    },
                ),
                nonce_rent,
                disposable_wallet.key,
            )?;

            msg!(
                "Prepared bundle account {}: disposable={}, nonce={}, amount={}",
                index,
                disposable_wallet.key(),
                nonce_account.key(),
                amount
            );
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct FundBundleAccounts<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    /// CHECK: Required by the System Program durable nonce initializer.
    #[account(address = solana_sysvar::recent_blockhashes::ID)]
    pub recent_blockhashes: UncheckedAccount<'info>,

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

fn checked_sum(amounts: &[u64]) -> Result<u64> {
    amounts.iter().try_fold(0u64, |total, &amount| {
        require!(amount > 0, DispenserError::ZeroAmount);
        total
            .checked_add(amount)
            .ok_or(error!(DispenserError::ArithmeticOverflow))
    })
}

fn validate_disposable_wallet(account: &AccountInfo<'_>) -> Result<()> {
    require!(account.is_signer, DispenserError::DisposableWalletMustSign);
    require!(
        account.is_writable,
        DispenserError::DisposableWalletNotWritable
    );
    require!(
        account.owner == &system_program::ID,
        DispenserError::DisposableWalletNotSystemOwned
    );
    Ok(())
}

fn validate_nonce_account(account: &AccountInfo<'_>) -> Result<()> {
    require!(account.is_signer, DispenserError::NonceAccountMustSign);
    require!(account.is_writable, DispenserError::NonceAccountNotWritable);
    require!(
        account.owner == &system_program::ID,
        DispenserError::NonceAccountNotSystemOwned
    );
    require!(account.lamports() == 0, DispenserError::NonceAccountNotEmpty);
    require!(account.data_is_empty(), DispenserError::NonceAccountNotEmpty);
    Ok(())
}

#[error_code]
pub enum DispenserError {
    #[msg("At least one bundle account is required")]
    NoBundleAccounts,
    #[msg("Too many bundle accounts requested")]
    TooManyBundleAccounts,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Remaining accounts must be [disposable, nonce] pairs matching amounts")]
    BundleAccountMismatch,
    #[msg("Duplicate account in bundle")]
    DuplicateBundleAccount,
    #[msg("Funder balance is too low for disposable amounts plus nonce rent")]
    InsufficientFunderBalance,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Disposable wallet must sign")]
    DisposableWalletMustSign,
    #[msg("Disposable wallet must be writable")]
    DisposableWalletNotWritable,
    #[msg("Disposable wallet must be system-owned")]
    DisposableWalletNotSystemOwned,
    #[msg("Nonce account must sign")]
    NonceAccountMustSign,
    #[msg("Nonce account must be writable")]
    NonceAccountNotWritable,
    #[msg("Nonce account must be system-owned")]
    NonceAccountNotSystemOwned,
    #[msg("Nonce account must be empty")]
    NonceAccountNotEmpty,
}
