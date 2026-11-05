Feature: A ledger account kept in one currency
  As an accountant who keeps a bank account in a foreign currency
  I want to fix that account's currency, but only until it has posted entries
  So that the history of the account is never silently reinterpreted

  Scenario: An account's currency can be set while it has no posted entries
    Given a ledger account with no posted entries and a currency "USD" exists
    When I set that account's currency to "USD"
    Then the account is kept in "USD"

  Scenario: An account's currency cannot be changed once it has a posted entry
    Given a ledger account has a posted entry
    And a currency "USD" exists
    When I try to set that account's currency to "USD"
    Then the currency change is rejected because the account has posted entries

  Scenario: An account's currency must be an existing currency
    Given a ledger account with no posted entries and a currency "USD" exists
    When I try to set that account's currency to an unknown currency
    Then the currency change is rejected because the currency does not exist
