Feature: Journal entry balance invariant
  As the ledger module itself
  I want postJournalEntry to refuse an entry before it ever touches the
  database when its lines are not balanced, or when a line has both (or
  neither) side populated
  So that "SUM(debit) = SUM(credit)" (art. 15 ust. 1 Ustawy o rachunkowości)
  can never be violated by application code — this is application-layer
  enforcement of the same invariant the deferred
  `journal_entry_line_balanced` constraint trigger enforces as a
  last-resort DB-level guard (see migrations)

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
