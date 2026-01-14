# Currency and Exchange management module

## DB tables

- currency: Currency master
- exchange_rate: Daily exchange rates

## Indexing strategy

  Composite index on (account_id, period_id, posting_date)
  Index on document numbers (invoice_number, payment_number)
  Index on vendor_id and customer_id
  Full-text index on descriptions for search

## Partitioning

    Partition journal entries by fiscal year
    Partition audit log by month

## Non-Functional Requirements

| ID | Requirement |
| -- | ---------- |
| NFR-1 | All financial postings must be atomic (full transaction rollback on error) |
| NFR-2 | Audit trail must be immutable (no deletion of posted transactions) |
| NFR-3 | Support 10,000+ chart of accounts entries |
| NFR-4 | Handle 1 million+ transactions per fiscal year |
| NFR-5 | Period close process must complete in < 5 minutes |
| NFR-6 | Financial reports must generate in < 10 seconds |
| NFR-7 | Support 100+ concurrent users |
| NFR-8 | 99.9% uptime during business hours |
| NFR-9 | Database backup every 4 hours with point-in-time recovery |
| NFR-10 | Support PostgreSQL 14+ with proper indexing on transaction tables |
| NFR-11 | Comply with SOX requirements for financial data retention (7 years) |
| NFR-12 | Support multi-tenancy with complete data isolation |
| NFR-13 | Zero downtime deployments for patches |
| NFR-14 | Currency amounts stored with 4 decimal precision |
| NFR-15 | Response time < 200ms for balance lookups |

## Use Case: Multi-Currency Sales Invoice

    Trigger: Sales order created in EUR (base currency: USD)
    Steps:
        System retrieves EUR/USD exchange rate for order date
        Generate invoice in EUR
        Calculate USD equivalent (EUR amount × rate)
        Post AR: DR Accounts Receivable USD equivalent, CR Revenue USD equivalent
        Store both EUR and USD amounts
        On payment in EUR:
            Calculate payment USD equivalent at payment date rate
            Calculate realized G/L = (payment rate - invoice rate) × EUR amount
            Post: DR Cash USD, DR/CR Realized G/L, CR AR USD
    Reporting: Show both transaction currency and base currency
