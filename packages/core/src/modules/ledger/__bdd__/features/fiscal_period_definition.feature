Feature: Fiscal periods are non-overlapping date ranges
  As an accountant defining the accounting calendar
  I want a fiscal period to be any date range that does not overlap another period of the same organization
  So that every operation date belongs to exactly one period

  Scenario: A period that overlaps an existing one is rejected
    Given an existing fiscal period from "2026-01-01" to "2026-01-31"
    When I create a fiscal period from "2026-01-31" to "2026-02-28"
    Then the period is rejected because it overlaps an existing one

  Scenario: A period of any length that does not overlap is accepted
    Given an existing fiscal period from "2026-01-01" to "2026-01-31"
    When I create a fiscal period from "2026-02-01" to "2026-03-15"
    Then the period is created
