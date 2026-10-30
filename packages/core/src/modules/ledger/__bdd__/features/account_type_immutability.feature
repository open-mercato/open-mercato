Feature: Account type and account immutability once posted
  As an accountant relying on the chart of accounts for reporting
  I want an account type's classification and the numbers of types and accounts to stay fixed once entries have been posted against them
  So that historical entries and JPK output can never be silently reinterpreted by a later reclassification or renumbering

  Scenario: Changing normal balance is rejected once the type has a posted entry
    Given a ledger account of a type with normal balance "DEBIT" has a posted entry
    When I try to change that account type's normal balance to "CREDIT"
    Then the change is rejected because the type has posted entries

  Scenario: Changing normal balance is allowed when the type has no posted entries
    Given a ledger account of a type with normal balance "DEBIT" has no posted entries
    When I try to change that account type's normal balance to "CREDIT"
    Then the change succeeds

  Scenario: Reclassifying an account to a different account type is rejected once it has a posted entry
    Given a ledger account has a posted entry
    When I try to change that account to a different account type
    Then the change is rejected because the account has posted entries

  Scenario: A type number cannot change after postings, but the name can
    Given a Polish account type numbered "402" has an account with a posted entry
    When I try to change that type's number to "403"
    Then the change is rejected because the type has posted entries
    When I rename that type to "Usługi obce"
    Then the change succeeds

  Scenario: An account number cannot change once the account has a posted entry
    Given an account numbered "402-1" of a Polish account type has a posted entry
    When I try to change that account's number to "402-2"
    Then the change is rejected because the account has posted entries
