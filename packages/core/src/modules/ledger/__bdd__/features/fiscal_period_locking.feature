Feature: Fiscal period locking blocks posting
  As an accountant closing a period
  I want postJournalEntry to reject any entry whose operation date falls
  inside a locked fiscal period, and to reject one with no covering period
  at all
  So that a closed accounting period stays immutable and no entry is ever
  posted "into the void" (spec: .ai/specs/2026-08-18-general-ledger-core-engine.md,
  Invariants + Edge Cases & Failure Scenarios)

  Scenario: Posting into a locked period is rejected
    Given a fiscal period from "2026-01-01" to "2026-01-31" that is locked
    When I post a balanced journal entry dated "2026-01-15"
    Then the post is rejected because the fiscal period is locked

  Scenario: Posting into an open period succeeds
    Given a fiscal period from "2026-02-01" to "2026-02-28" that is open
    When I post a balanced journal entry dated "2026-02-15"
    Then the post succeeds and a journal entry is recorded with sequence number 1

  Scenario: Posting when no fiscal period covers the date at all is rejected
    Given no fiscal period exists for "2026-03-10"
    When I post a balanced journal entry dated "2026-03-10"
    Then the post is rejected because no fiscal period covers the date
