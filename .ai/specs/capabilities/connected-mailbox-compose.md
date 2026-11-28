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

### Scenario: Open the saved message when queue submission is unconfirmed

- WHEN the mailbox message, linked records and files commit and queue submission then throws
- THEN the composer opens that message with a delivery warning and support can trace its scoped outbound link
- AND a worker that already accepted the job keeps its delivery status and receives no duplicate submission

See the [connected mailbox composer specification](../2026-09-19-composer-send-from-connected-mailbox.md) and the [queue recovery design in PR #10366](https://github.com/open-mercato/open-mercato/pull/10366).
