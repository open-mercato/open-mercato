# Capability: crm-employment-history

CRM staff can record departures and find former employees on company records.

## Requirement: End employment and retain the link

The system SHALL retain a dated, ended association when a permitted user ends an active person–company link, including a legacy profile assignment. The dialog and API use the browser’s IANA time zone to accept dates through today. The recorded value is a calendar date.

### Scenario: Primary departure

- WHEN a user ends a person's primary association with a valid departure date
- THEN company detail shows that person under Former employees with the date, the company is absent from the person's active links, and the next eligible active link becomes primary if available

### Scenario: Concurrent edit

- WHEN a user submits an end action against a version superseded by another link mutation
- THEN the system returns a record conflict and preserves the newer state

Source: [End a person–company link and retain employment history](https://github.com/open-mercato/open-mercato/pull/10681)

## Requirement: Reactivate a former employee

The system SHALL reactivate the existing association when a user links the person to that company again.

### Scenario: Rejoin a company

- WHEN a user links a person who previously left the company
- THEN the person appears once in the active list and is absent from Former employees, with the last departure date retained on the association

Source: [End a person–company link and retain employment history](https://github.com/open-mercato/open-mercato/pull/10681)

## Migration & Backward Compatibility

The end-employment request accepts an optional `timezone` alongside `endedOn`. Requests that omit it keep the UTC date limit. The time zone affects validation only and requires no schema migration.
