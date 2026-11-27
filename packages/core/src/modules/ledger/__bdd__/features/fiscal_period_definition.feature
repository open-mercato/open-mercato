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

  Scenario: Generating 12 months creates twelve consecutive monthly periods
    Given no fiscal periods exist
    When I generate 12 months starting "2027-01-01"
    Then twelve consecutive monthly periods exist from "2027-01-01" to "2027-12-31"

  Scenario: Generating 12 months is rejected when it overlaps an existing period
    Given an existing fiscal period from "2027-06-01" to "2027-06-30"
    When I generate 12 months starting "2027-01-01"
    Then the period is rejected because it overlaps an existing one
    And only the existing period remains

  Scenario: Generating 12 months must start on the first day of a month
    Given no fiscal periods exist
    When I generate 12 months starting "2027-01-15"
    Then the request is rejected because the start is not the first day of a month
