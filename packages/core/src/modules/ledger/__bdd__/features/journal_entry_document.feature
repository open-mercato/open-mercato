Feature: A posted entry carries the document it records
  As an accountant relying on the ledger for statutory reporting
  I want the document type and number given on an entry to be kept on it
  So that every entry can be traced to its source document (art. 23 ust. 2 pkt 2 Ustawy o rachunkowości)

  Scenario: The document type and number given on an entry are kept on it
    Given an open fiscal period and two accounts to post against
    When I post a balanced entry with document type "external_own" and document number "FV/2026/06/00123"
    Then the posted entry carries document type "external_own" and document number "FV/2026/06/00123"

  Scenario: An entry with no document reference is accepted while no caller requires one
    Given an open fiscal period and two accounts to post against
    When I post a balanced entry with no document reference
    Then the posted entry carries no document type and no document number
