Feature: Importing the default Polish chart of accounts
  As an accountant setting up a new organization's ledger
  I want to fill an empty chart of accounts with a complete, ready-to-use
  starting set of account types and accounts in one step
  So that I can start posting entries right away instead of creating
  dozens of accounts by hand

  Scenario: Importing into an empty chart of accounts creates a complete starting point
    Given an organization with no account types or accounts yet
    When I import the default chart of accounts
    Then the chart of accounts is populated with a full, correctly classified starting set of account types and accounts
    And every imported account and account type can be edited afterward exactly like one created by hand

  Scenario: The import is refused when the chart of accounts is not empty
    Given an organization whose chart of accounts already has at least one account type or account
    When I try to import the default chart of accounts
    Then the import is rejected because the chart of accounts is not empty, and nothing is created

  Scenario: Accounts removed earlier do not block a fresh import
    Given an organization whose only account types and accounts have since been removed
    When I import the default chart of accounts
    Then the import succeeds and the full starting chart of accounts is created

  Scenario: Undoing the import returns the chart of accounts to empty
    Given an organization that just imported the default chart of accounts
    When I undo that import
    Then the chart of accounts is empty again

  Scenario: Importing into one organization never affects another organization's chart of accounts
    Given two organizations, one with an existing chart of accounts and one with none
    When I import the default chart of accounts into the organization that has none
    Then only that organization's chart of accounts changes, and the other organization's chart of accounts is untouched
