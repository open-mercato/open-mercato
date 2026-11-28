# Capability: crm-activity-creation

Sales teams create past and future activities from the record detail composer.

## Requirement: Create an activity from CRM record detail

The activity composer SHALL let the user choose one date and time to create a logged or planned activity.

### Scenario: Historical meeting

- WHEN a user selects a meeting time two days ago and saves
- THEN the interaction is done and appears in history with that occurrence time

### Scenario: Future callback

- WHEN a user selects a call time in the future and saves
- THEN the interaction is planned with that scheduled time and is visible in Planned activities

### Scenario: Log now

- WHEN a user saves with the date and time at its default
- THEN the interaction is done and records the submit instant

Source: .ai/specs/2026-11-22-crm-activity-date-time.md
