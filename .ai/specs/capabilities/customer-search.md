# Capability: customer-search

Staff can find customer users and person and company profiles using the lexical strategies enabled for their deployment.

## Requirement: Customer record indexing eligibility

The built-in registrations SHALL use fulltext and tokens for customer users and person and company profiles. The built-in vector strategy SHALL skip embedding and upserting these record types, including sparse records and ID-only accounts.

### Scenario: Index a customer record

- WHEN the app indexes a customer user, person profile, or company profile through a live write, a queued job, or reindex
- THEN fulltext and token lookup remain eligible under the existing field, ACL, tenant, and organization rules
- THEN the vector provider receives no record embedding input for that record

Source: .ai/specs/2026-11-21-customer-vector-semantics.md
