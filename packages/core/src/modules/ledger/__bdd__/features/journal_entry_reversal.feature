Feature: Reversing a posted journal entry
  As an accountant who posted an entry by mistake
  I want to reverse it with a new, separately numbered entry whose lines
  are inverted, dated in the reversal's own (open) period rather than the
  original's
  So that the correction lands in a period that can still be edited, even
  when the original entry's own period has since been locked, without
  ever mutating or deleting the original (spec: Design decisions,
  "Corrections are reversals, not undo" / "a reversal exists to move a
  correction into an open period")

  Scenario: Reversing an entry whose original period is now locked, into a still-open period
    Given a journal entry was posted for 100.00 from "cash" to "revenue", now in a locked period
    And a fiscal period from "2026-05-01" to "2026-05-31" that is open
    When I reverse that entry with operation date "2026-05-15"
    Then the reversal succeeds as a new REVERSAL entry with inverted lines referencing the original
