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

Given('a ledger account of a type with normal balance {string} has a posted entry', function () {
  return 'pending'
})

Given('a ledger account of a type with normal balance {string} has no posted entries', function () {
  return 'pending'
})

When('I try to change that account type\'s normalBalance to {string}', function () {
  return 'pending'
})

Then('the change is rejected because the type has posted entries', function () {
  return 'pending'
})

Then('the change succeeds', function () {
  return 'pending'
})
