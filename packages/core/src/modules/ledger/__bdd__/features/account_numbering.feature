Feature: Account numbers follow the Polish chart of accounts
  As an accountant keeping a Polish chart of accounts
  I want a type number to start with the digit of its group and an account number to start with the number of its type
  So that the number alone tells which group an account belongs to, and a wrong number is refused whatever form or client sends it

  Scenario: A type number that does not start with its group digit is rejected
    Given a Polish account group with code "2"
    When I create an account type numbered "499" in that group
    Then the type is rejected because its number does not start with the group digit

  Scenario: A type number that is not three digits is rejected
    Given a Polish account group with code "4"
    When I create an account type numbered "49" in that group
    Then the type is rejected because its number is not three digits

  Scenario: A type number that starts with its group digit is accepted
    Given a Polish account group with code "4"
    When I create an account type numbered "402" in that group
    Then the type is created

  Scenario: An account number that does not start with its type number is rejected
    Given a Polish account type numbered "402"
    When I create an account numbered "403-1" under that type
    Then the account is rejected because its number does not start with the type number

  Scenario: An account number that starts with its type number is accepted
    Given a Polish account type numbered "402"
    When I create an account numbered "402-1" under that type
    Then the account is created
