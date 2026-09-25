Feature: Reversing a posted journal entry
  As an accountant who posted an entry by mistake
  I want to reverse it with a new, separately numbered entry whose lines
  are inverted, dated in the reversal's own (open) period rather than the
  original's
  So that the correction lands in a period that can still be edited, even
  when the original entry's own period has since been locked, without
  ever mutating or deleting the original

  Scenario: Reversing an entry whose original period is now locked, into a still-open period
    Given a journal entry was posted for "100.00" from "cash" to "revenue", now in a locked period
    And a fiscal period from "2026-05-01" to "2026-05-31" that is open
    When I reverse that entry with operation date "2026-05-15"
    Then the reversal succeeds as a new REVERSAL entry with inverted lines referencing the original

  Scenario: Reversing an entry that is itself a reversal is rejected
    Given a journal entry was posted for "100.00" from "cash" to "revenue", now in a locked period
    And a fiscal period from "2026-05-01" to "2026-05-31" that is open
    And that entry has already been reversed, dated "2026-05-15"
    When I try to reverse that reversal entry
    Then the attempt is rejected because a reversal cannot itself be reversed

  Scenario: Reversing the same entry a second time is rejected
    Given a journal entry was posted for "100.00" from "cash" to "revenue", now in a locked period
    And a fiscal period from "2026-05-01" to "2026-05-31" that is open
    And that entry has already been reversed, dated "2026-05-15"
    When I try to reverse the original entry again
    Then the attempt is rejected because the entry has already been reversed
