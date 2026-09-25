Feature: Journal entry sequence numbering
  As an accountant relying on the ledger for a complete, auditable record
  I want each organization's journal entries numbered consecutively, with
  no gaps and never mixed with another organization's numbering
  So that the uninterrupted, verifiable numbering required by art. 14 ust. 2
  Ustawy o rachunkowości can never be violated

  Scenario: An organization's entries are numbered consecutively
    Given an organization has posted one balanced journal entry, numbered 1
    When I post another balanced journal entry for that organization
    Then the new entry is recorded with sequence number 2

  Scenario: A rejected posting attempt does not consume a sequence number
    Given an organization has posted one balanced journal entry, numbered 1
    When I attempt to post an unbalanced entry for that organization, and then post a balanced one
    Then the balanced entry is recorded with sequence number 2, not 3

  Scenario: Two organizations under the same tenant number their entries independently
    Given organization A and organization B belong to the same tenant, and neither has posted any entries yet
    When I post a balanced journal entry for organization A
    And I post a balanced journal entry for organization B
    Then organization A's entry is recorded with sequence number 1
    And organization B's entry is recorded with sequence number 1, independently of organization A's
