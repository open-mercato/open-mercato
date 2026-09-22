Feature: Delete blocking for accounts and account types with posted entries
  As the ledger module itself
  I want deleteLedgerAccount and deleteLedgerAccountType to refuse a
  soft-delete when the record still has posted journal entry lines (or,
  for an account type, is still named as another type's parent)
  So that a chart-of-accounts record backing real accounting history can
  never disappear out from under it (spec: Queries/API section, "delete
  blocked once posted entries exist")

  # NOT YET WIRED TO REAL COMMAND EXECUTION — same reason as
  # `account_type_immutability.feature`: `commands/ledgerAccounts.ts` and
  # `commands/ledgerAccountTypes.ts` both import
  # `#generated/entities.ids.generated` at module top level, which does not
  # exist in this repo until `yarn generate` runs. See `../README.md`.

  Scenario: Deleting an account with posted entries is rejected
    Given a ledger account has a posted entry
    When I try to delete that account
    Then the delete is rejected because the account has posted entries

  Scenario: Deleting an account type still referenced as another type's parent is rejected
    Given a ledger account type is the declared parent of another account type
    When I try to delete that parent account type
    Then the delete is rejected because another account type still lists it as parent
