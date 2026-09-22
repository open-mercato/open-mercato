Feature: Account type immutability once posted
  As the ledger module itself
  I want updateLedgerAccountType to reject a change to normalBalance or
  accountGroupId once any account of that type has a posted journal entry
  line
  So that an account's fundamental accounting classification can never
  silently shift out from under entries already posted against it
  (spec: Testing Strategy — accountTypeHasPostedEntries)

  # NOT YET WIRED TO REAL COMMAND EXECUTION — see
  # `../README.md` § "Verification status: account-type / account
  # scenarios" for the concrete, diagnosed reason
  # (`#generated/entities.ids.generated` does not exist in this repo until
  # `yarn generate` runs; `commands/ledgerAccountTypes.ts` imports it at
  # module top level via `CrudIndexerConfig`, so simply requiring that file
  # fails before any step runs). These scenarios are marked `pending` so
  # `test:bdd` reports them as deliberately deferred, not broken.

  Scenario: Changing normalBalance is rejected once the type has a posted entry
    Given a ledger account of a type with normal balance "DEBIT" has a posted entry
    When I try to change that account type's normalBalance to "CREDIT"
    Then the change is rejected because the type has posted entries

  Scenario: Changing normalBalance is allowed when the type has no posted entries
    Given a ledger account of a type with normal balance "DEBIT" has no posted entries
    When I try to change that account type's normalBalance to "CREDIT"
    Then the change succeeds
