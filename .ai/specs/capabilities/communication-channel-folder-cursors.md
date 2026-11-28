# Capability: communication-channel-folder-cursors

Host workers can checkpoint independent mailbox folder content sync.

## Requirement: Independent folder progress

The system SHALL persist each folder cursor independently of other folders and channel polling and push state.

### Scenario: Concurrent progress

- WHEN a host worker advances one folder and another worker advances a different folder while the channel poller updates its state
- THEN both folder cursors and the channel state remain available at their respective checkpoints

## Requirement: Concurrent writes to one folder

The system SHALL advance a folder cursor only when its version matches the worker's last read.

### Scenario: Two workers start with the same cursor

- WHEN two workers submit advances for the same version, including an absent cursor
- THEN at most one advance succeeds and the other worker can reload the winning version

## Requirement: Channel scope

The system SHALL restrict cursor reads and writes to a channel in the supplied tenant and exact organization scope.

### Scenario: Channel outside scope or soft-deleted

- WHEN a worker provides a different tenant or organization, or the channel has been soft-deleted
- THEN no cursor is returned and no advance succeeds

Source: .ai/specs/2026-11-22-channel-folder-cursors.md
