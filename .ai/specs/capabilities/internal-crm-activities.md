# Capability: internal-crm-activities

Staff can manage native Calendar activities and Tasks with an optional CRM relationship.

## Requirement: Calendar activities and canonical interaction creation accept a CRM relationship

The system SHALL create native non-email activities from Calendar or the canonical interactions API with or without a primary CRM link.

### Scenario: Schedule an internal standup

- WHEN a staff member with manage permission saves an event with no related record
- THEN the event appears in their scoped Calendar and is absent from CRM profiles and deal-filtered reads.

### Scenario: Keep an activity on a CRM profile

- WHEN a staff member supplies a scoped person or company when creating an activity
- THEN the system stores the relationship and applies the existing next-interaction projection rules.

Source: .ai/specs/2026-11-22-internal-crm-activities.md

## Requirement: An interaction can be relinked to another CRM record

The system SHALL support attaching and clearing an eligible activity's primary CRM link while preserving its identity and updating the affected projections.

### Scenario: Remove a primary link

- WHEN a staff member clears the primary record on an existing activity
- THEN the activity retains its id, fields and history, the former parent's projection is refreshed, and undo can restore the link.

Source: .ai/specs/2026-11-22-internal-crm-activities.md
