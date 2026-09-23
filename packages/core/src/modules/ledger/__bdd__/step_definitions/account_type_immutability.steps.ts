// Step definitions for `../features/account_type_immutability.feature`.
//
// Deliberately NOT wired to the real `ledger.updateLedgerAccountType`
// command yet. That command's module
// (`commands/ledgerAccountTypes.ts`) imports
// `#generated/entities.ids.generated` at its top level (for
// `CrudIndexerConfig.entityType`), and that generated file does not exist
// in this repo until `yarn generate` runs (see `../README.md`) — so
// simply `require`-ing the command module would crash before any scenario
// step even executes. Every step below returns Cucumber's own `'pending'`
// status rather than faking a pass, so `test:bdd` reports these two
// scenarios as explicitly deferred work, not as silently-skipped or
// falsely-green.
import { Given, When, Then } from '@cucumber/cucumber'

// Cucumber validates a step function's arity against its Cucumber
// Expression's placeholder count even for a 'pending' return — a 0-arg
// function against a `{string}` placeholder throws "function has 0
// arguments, should have 1..." the moment the step is actually invoked.
// These two were written before the suite could ever run at all in this
// environment, so nobody had seen that until now.
Given('a ledger account of a type with normal balance {string} has a posted entry', function (_normalBalance: string) {
  return 'pending'
})

Given('a ledger account of a type with normal balance {string} has no posted entries', function (_normalBalance: string) {
  return 'pending'
})

When('I try to change that account type\'s normalBalance to {string}', function (_newNormalBalance: string) {
  return 'pending'
})

Then('the change is rejected because the type has posted entries', function () {
  return 'pending'
})

Then('the change succeeds', function () {
  return 'pending'
})

// New scenario (LedgerAccount.accountTypeId immutability — a distinct
// guard in `commands/ledgerAccounts.ts` from the normalBalance/
// accountGroupId one above, but blocked by the exact same
// `#generated/entities.ids.generated` issue). "Given a ledger account has
// a posted entry" is deliberately NOT redefined here — it already exists,
// globally, in `delete_blocking.steps.ts`; Cucumber matches step text
// across every step-definition file, and redefining it here would be an
// ambiguous-step error.
When('I try to change that account to a different account type', function () {
  return 'pending'
})

Then('the change is rejected because the account has posted entries', function () {
  return 'pending'
})
