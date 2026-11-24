# Capability: crm-deal-reopen

CRM operators can recover closed deals from the detail page.

## Requirement: Reopen a closed deal from its detail page

The system SHALL let an authorized operator move a closed deal to an open stage in its current pipeline.

### Scenario: Reopening a closed deal

- WHEN a user with deal-management and reopen permission confirms a valid destination for a closed deal
- THEN the deal becomes open in that stage, its current closure outcome and loss details clear, and its forecast close date is preserved

### Scenario: Reopen permission is absent

- WHEN a user can edit a deal and lacks the reopen grant
- THEN the detail page hides Reopen deal and the reopen endpoint rejects the request

### Scenario: The supplied version is stale

- WHEN the deal has changed since the operator loaded it
- THEN the action returns the standard optimistic-lock conflict and offers refresh

Source: .ai/specs/2026-11-24-deal-reopen.md

## Requirement: Lost confirmation describes how to recover a deal

The confirmation SHALL describe the Lost transition and the availability of the dedicated Reopen deal action to authorized users.

### Scenario: Confirming a loss

- WHEN an operator opens the Lost confirmation
- THEN the warning refers to the Reopen deal action and its permission

Source: .ai/specs/2026-11-24-deal-reopen.md
