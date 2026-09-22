// Step definitions for `../features/delete_blocking.feature`.
//
// Same deliberate gap as `account_type_immutability.steps.ts`:
// `commands/ledgerAccounts.ts` and `commands/ledgerAccountTypes.ts` both
// import `#generated/entities.ids.generated` at module top level, which
// does not exist in this repo until `yarn generate` runs (see
// `../README.md`). Every step below returns `'pending'` rather than
// faking a pass.
import { Given, When, Then } from '@cucumber/cucumber'

Given('a ledger account has a posted entry', function () {
  return 'pending'
})

When('I try to delete that account', function () {
  return 'pending'
})

Then('the delete is rejected because the account has posted entries', function () {
  return 'pending'
})

Given('a ledger account type is the declared parent of another account type', function () {
  return 'pending'
})

When('I try to delete that parent account type', function () {
  return 'pending'
})

Then('the delete is rejected because another account type still lists it as parent', function () {
  return 'pending'
})
