# Capability: CRM person phone lookup

Authorized callers can look up a visible CRM person by the exact digits of their current primary phone.

## Requirement: Exact CRM person phone lookup

The system SHALL find an indexed, visible person whose normalized primary phone equals the requested digits, regardless of how many newer contacts exist.

### Scenario: An older encrypted contact has been indexed

- WHEN a caller searches for the exact digits of an indexed, visible person outside the newest 500 candidates
- THEN the response includes a matching person ID and decrypted display name

### Scenario: A contact changes or clears their phone

- WHEN the current phone value changes or is cleared
- THEN the old digits no longer match that person

Source: .ai/specs/2026-11-22-customers-phone-blind-index.md
