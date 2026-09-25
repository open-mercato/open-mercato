Feature: Every posted entry carries its business operation date
  As an accountant relying on the ledger for statutory reporting
  I want an entry with no operation date to be refused before it can ever be posted
  So that the date a business event actually happened is never left to be
  reconstructed after the fact (art. 23 ust. 2 Ustawy o rachunkowości)

  Scenario: An entry with no operation date is rejected
    When I attempt to post an entry with no operation date specified
    Then the attempt is rejected before any posting is attempted, citing the missing operation date
