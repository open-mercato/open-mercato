Feature: Delete blocking for accounts and account types with posted entries
  As an accountant maintaining the chart of accounts
  I want a soft-delete to be refused when the record still has posted
  journal entry lines (or, for an account type, is still named as
  another type's parent)
  So that a chart-of-accounts record backing real accounting history can
  never disappear out from under it

  # Not yet wired to a real run — same reason as
  # account_type_immutability.feature; see ../README.md.

  Scenario: Deleting an account with posted entries is rejected
    Given a ledger account has a posted entry
    When I try to delete that account
    Then the delete is rejected because the account has posted entries

  Scenario: Deleting an account type still referenced as another type's parent is rejected
    Given a ledger account type is the declared parent of another account type
    When I try to delete that parent account type
    Then the delete is rejected because another account type still lists it as parent
