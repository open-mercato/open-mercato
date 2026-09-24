Feature: Account type immutability once posted
  As an accountant relying on the chart of accounts for reporting
  I want an account type's fundamental classification to stay fixed once
  entries have been posted against it
  So that historical entries can never be silently reinterpreted by a
  later reclassification

  # Not yet wired to a real run — see ../README.md for why, and why
  # these scenarios are marked `pending` rather than broken.

  Scenario: Changing normalBalance is rejected once the type has a posted entry
    Given a ledger account of a type with normal balance "DEBIT" has a posted entry
    When I try to change that account type's normalBalance to "CREDIT"
    Then the change is rejected because the type has posted entries

  Scenario: Changing normalBalance is allowed when the type has no posted entries
    Given a ledger account of a type with normal balance "DEBIT" has no posted entries
    When I try to change that account type's normalBalance to "CREDIT"
    Then the change succeeds

  Scenario: Reclassifying an account to a different account type is rejected once it has a posted entry
    Given a ledger account has a posted entry
    When I try to change that account to a different account type
    Then the change is rejected because the account has posted entries
