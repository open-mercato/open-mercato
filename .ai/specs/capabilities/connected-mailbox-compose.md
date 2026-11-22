# Capability: connected-mailbox-compose

Employees can send public messages with attachments through their connected mailbox and keep linked records on the in-app copy.

## Requirement: Compose payload from a connected mailbox

The system SHALL accept supported files and linked records on a new public compose through an employee's connected mailbox.

### Scenario: Send files and link a CRM record

- WHEN the sender sends a public message with eligible files and a supported linked record through an owned, connected mailbox
- THEN the provider receives the files, the sent message shows the files and linked record, and replies can use the existing mailbox thread mapping

### Scenario: Refuse an unavailable or unsupported file

- WHEN any selected file is unavailable in the compose scope, cannot be reassigned, or exceeds the chosen adapter's limits
- THEN the composer reports the failure and the message and delivery are never created

Source: .ai/specs/2026-11-22-connected-mailbox-composer-payload.md
