# Capability: shared-mailbox-sending

Employees can send through a connected colleague-owned mailbox when an in-process caller authorizes the send.

## Requirement: Authorize a programmatic send through a user-owned mailbox

The hub SHALL accept a non-owner send through a connected mailbox when the in-process policy approves the actor in the same tenant and organization. The actor is the message author and the mailbox owner supplies the credentials.

### Scenario: A colleague replies for the shared mailbox

- WHEN the policy explicitly approves the actor and the scoped channel has an owner
- THEN the send is accepted and the actor is recorded as the author

Source: .ai/specs/2026-11-21-trusted-shared-mailbox-sending.md

## Requirement: Preserve a named Gmail sender through delivery

Gmail SHALL use the per-message display name in the From header when supplied, keeping the mailbox credential address.

### Scenario: An employee supplies a display name for a reply

- WHEN a message specifies `channelMetadata.fromName`
- THEN the Gmail message carries the normalized display name and the connected mailbox address

Source: .ai/specs/2026-11-21-trusted-shared-mailbox-sending.md
