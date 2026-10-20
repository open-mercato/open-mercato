Feature: Delete blocking for accounts with posted entries
  As an accountant maintaining the chart of accounts
  I want a delete to be refused when the account still has posted journal entry lines
  So that a chart-of-accounts record backing real accounting history can never disappear out from under it

  Scenario: Deleting an account with posted entries is rejected
    Given a ledger account has a posted entry
    When I try to delete that account
    Then the delete is rejected because the account has posted entries
