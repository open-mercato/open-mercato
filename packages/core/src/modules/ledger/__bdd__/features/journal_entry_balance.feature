Feature: Journal entry balance invariant
  As an accountant who relies on the ledger to never record an unbalanced entry
  I want an entry to be refused before it can affect the books at all when
  its lines are not balanced, or when a line has both (or neither) side
  populated
  So that "SUM(debit) = SUM(credit)" (art. 15 ust. 1 Ustawy o rachunkowości)
  can never be violated

  Scenario: An entry whose debits and credits do not sum to the same total is rejected
    When I attempt to post an entry with lines:
      | account | side   | amount |
      | cash    | debit  | 100.00 |
      | revenue | credit | 90.00  |
    Then the attempt is rejected before any posting is attempted, citing the balance invariant

  Scenario: A line with neither debit nor credit populated is rejected
    When I attempt to post an entry with lines:
      | account | side   | amount |
      | cash    | none   | 0      |
      | revenue | credit | 100.00 |
    Then the attempt is rejected before any posting is attempted, citing the one-sided-line invariant

  Scenario: A balanced entry is posted successfully
    When I attempt to post an entry with lines:
      | account | side   | amount |
      | cash    | debit  | 100.00 |
      | revenue | credit | 100.00 |
    Then the entry is posted successfully

  Scenario: A line with both debit and credit populated is rejected
    When I attempt to post an entry with lines:
      | account | side   | amount |
      | cash    | both   | 50.00  |
      | revenue | credit | 50.00  |
    Then the attempt is rejected before any posting is attempted, citing the one-sided-line invariant
