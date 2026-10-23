Feature: Currency, exchange rate and original amount on every journal entry line
  As an accountant who books foreign-currency documents
  I want every line to keep its own currency, the rate it was converted at
  and its amount in the original currency, next to the base-currency
  debit/credit
  So that open items and exchange differences can be traced per line, while
  the entry still balances in the base currency only

  Background:
    Given a ledger with base currency "PLN", foreign currencies "EUR" and "USD", and an open fiscal period for October 2026

  Scenario: A mixed-currency entry that balances in the base currency is posted and each line keeps its currency, rate and original amount
    When I post an entry with header currency "EUR" and rate "4.30000000" and lines:
      | account  | side   | amount | currency | rate       | original |
      | bank_usd | debit  | 400.00 | USD      | 4.00000000 | 100.00   |
      | expense  | debit  | 30.00  | PLN      |            |          |
      | payable  | credit | 430.00 | EUR      | 4.30000000 | 100.00   |
    Then the entry is stored with these lines:
      | account  | currency | rate       | original |
      | bank_usd | USD      | 4.00000000 | 100.00   |
      | expense  | PLN      | 1          | 30.00    |
      | payable  | EUR      | 4.30000000 | 100.00   |

  Scenario: A line that omits its currency takes the header currency and rate
    When I post an entry with header currency "EUR" and rate "4.30000000" and lines:
      | account | side   | amount | currency | rate | original |
      | expense | debit  | 430.00 | PLN      |      |          |
      | payable | credit | 430.00 |          |      | 100.00   |
    Then the entry is stored with these lines:
      | account | currency | rate       | original |
      | expense | PLN      | 1          | 430.00   |
      | payable | EUR      | 4.30000000 | 100.00   |

  Scenario: A foreign-currency line without an original amount is rejected
    When I post an entry with header currency "PLN" and no rate and lines:
      | account | side   | amount | currency | rate       | original |
      | expense | debit  | 430.00 | PLN      |            |          |
      | payable | credit | 430.00 | EUR      | 4.30000000 |          |
    Then the post is rejected with status 422 because the line needs an original-currency amount

  Scenario: A foreign-currency line without an exchange rate is rejected
    When I post an entry with header currency "PLN" and no rate and lines:
      | account | side   | amount | currency | rate | original |
      | expense | debit  | 430.00 | PLN      |      |          |
      | payable | credit | 430.00 | EUR      |      | 100.00   |
    Then the post is rejected with status 422 because the line needs an exchange rate

  Scenario: A line whose original amount times its rate does not match the base amount is rejected
    When I post an entry with header currency "PLN" and no rate and lines:
      | account | side   | amount | currency | rate       | original |
      | expense | debit  | 400.00 | PLN      |            |          |
      | payable | credit | 400.00 | EUR      | 4.30000000 | 100.00   |
    Then the post is rejected with status 422 because the original amount and rate do not match the base amount

  Scenario: An exchange-difference line with a zero original amount is accepted
    When I post an entry with header currency "PLN" and no rate and lines:
      | account    | side   | amount | currency | rate       | original |
      | receivable | debit  | 12.00  | EUR      | 4.30000000 | 0.00     |
      | fx_gain    | credit | 12.00  | PLN      |            |          |
    Then the entry is stored with these lines:
      | account    | currency | rate       | original |
      | receivable | EUR      | 4.30000000 | 0.00     |
      | fx_gain    | PLN      | 1          | 12.00    |

  Scenario: A line in a currency different from its account's currency is rejected
    When I post an entry with header currency "PLN" and no rate and lines:
      | account  | side   | amount | currency | rate       | original |
      | bank_usd | debit  | 430.00 | EUR      | 4.30000000 | 100.00   |
      | expense  | credit | 430.00 | PLN      |            |          |
    Then the post is rejected with status 422 because the line currency differs from its account

  Scenario: Reversing an entry keeps each line's currency, rate and original amount
    Given I have posted an entry with header currency "EUR" and rate "4.30000000" and lines:
      | account  | side   | amount | currency | rate       | original |
      | bank_usd | debit  | 400.00 | USD      | 4.00000000 | 100.00   |
      | expense  | debit  | 30.00  | PLN      |            |          |
      | payable  | credit | 430.00 | EUR      | 4.30000000 | 100.00   |
    When I reverse that entry with the same operation date
    Then the reversal is stored with these lines:
      | account  | currency | rate       | original |
      | bank_usd | USD      | 4.00000000 | 100.00   |
      | expense  | PLN      | 1          | 30.00    |
      | payable  | EUR      | 4.30000000 | 100.00   |
