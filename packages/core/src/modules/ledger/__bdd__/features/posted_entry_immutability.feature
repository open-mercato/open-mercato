Feature: A posted journal entry cannot be edited or deleted
  As an accountant answerable for the books
  I want a posted entry to stay exactly as it was posted
  So that the only way to correct it is a new, separately numbered reversal (art. 14 ust. 2 Ustawy o rachunkowości)

  Scenario: A posted entry cannot be edited or deleted
    Given a journal entry was posted for "100.00" from "cash" to "revenue", now in a locked period
    When I look for any way to edit or delete that entry
    Then none exists, and the entry is unchanged
