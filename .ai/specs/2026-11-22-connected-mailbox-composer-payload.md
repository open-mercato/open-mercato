# Attachments and linked records in connected-mailbox compose

Issue: #6261

Extends: .ai/specs/2026-09-19-composer-send-from-connected-mailbox.md
Extends: .ai/specs/2026-05-21-email-integration-foundation.md

## TLDR

An employee can now choose between a connected mailbox with reply threading and the platform sender with attachments and linked records. This change will let the employee send the same compose payload through their mailbox, with files delivered by the provider and linked records visible on the in-app sent message.

## Overview

The `/backend/messages/compose` controls already collect files and linked records. The change uses those controls and the existing sender field for provider validation errors. The scope is new public messages sent through a connected mailbox with `POST /api/messages`.

## Problem Statement

The Messages composer returns 422 on `senderChannelId` when a mailbox send includes an attachment ID, a temporary attachment record, or a linked record. The employee must remove the payload or change sender. Platform sends lack the channel mapping that makes incoming replies join the conversation.

## Prior spec drift

The September composer spec describes a hub with no attachment support. The October foundation amendment and [PR #7676](https://github.com/open-mercato/open-mercato/pull/7676) added scoped attachment references, validation and delivery for Gmail and IMAP/SMTP. The composer guard in `messages/lib/composeSenderDelegation.ts` still rejects the payload. The new work is the handoff from composer uploads to that existing delivery path and the sent message.

## Proposed Solution

Send the selected mailbox, the linked records, and the temporary attachment record with its selected file IDs. Validate the attachments while they are still under their temporary owner. Bind the files to the new in-app message during compose, then store outbound references pointing at that message. Save linked records through the existing message object command flow. The delivery job reads only file references alongside the existing provider message payload.

[Roundcube's compose upload flow](https://github.com/roundcube/roundcubemail/blob/master/program/actions/mail/attachment_upload.php) likewise associates uploads with a single compose session before send. Open Mercato already has a temporary upload record for the session and can reuse it.

## 📝 Delta

### Capability: connected-mailbox-compose

#### MODIFIED Requirement: Compose payload from a connected mailbox

The system SHALL accept the supported file and record selections on a new public compose through an employee's connected mailbox.

##### Scenario: Send files and link a CRM record

- WHEN the sender selects a connected email mailbox and sends a public message with eligible files and a supported linked record
- THEN the mailbox pipeline schedules one delivery carrying those files and the sent message displays both the files and the linked record

##### Scenario: Refuse an unavailable or unsupported file

- WHEN any selected file is unavailable in the compose scope or exceeds the chosen provider's limits
- THEN the composer shows a field error and no message or delivery is created

Frozen by: `packages/core/src/modules/messages/lib/__tests__/composeSenderDelegation.test.ts`

## Architecture

1. The composer already lists its files under a temporary `attachments:library` record whose ID starts with `messages-composer:`. For a mailbox send, it includes that record ID with the IDs it listed. The messages module resolves the source as a temporary compose record in the current tenant and organization. A request supplying IDs must bind them to that record. For record-only requests, resolve its files using a bounded lookup and reject a set over the hub cap.
2. The existing soft-optional `communicationChannelsSendAsUser` port receives ordinary scoped outbound attachment references and optional in-app compose context. The hub uses its existing adapter capability and attachment service checks. The messages compose command validates linked records against the original compose type while retaining the channel-qualified type of the persisted message.
3. For the new composer payload, the hub opens a shared command transaction for the message, linked objects, attachment moves, conversation mapping and outbound link. Match each expected source owner, file ID, tenant and organization during the move. A mismatch or link-write failure rolls back the entire compose, leaving the upload available for retry. Emit message side effects after commit.
4. The hub uses the new message ID as the owner of the sent-file refs. Enqueue after commit so the worker sees the link and final file owners. If enqueue fails, preserve the committed message and link for diagnosis and surface the existing send failure. The worker rechecks ownership, type and size on each attempt. Linked records stay in `MessageObject`.

## Data Models

Existing `MessageObject`, attachment owner fields and `MessageChannelLink.channelMetadata` carry the new behavior. File bytes remain in attachment storage. Temporary refs are converted to message-owned refs once the move commits. No schema migration is required.

## API Contracts

- `POST /api/messages` already accepts `objects`, `attachmentIds`, `attachmentRecordId` and `senderChannelId`. A successful send still returns 201 with message ID and thread ID. Invalid compose attachment ownership and provider preflight errors use the existing sender field error response. Existing route guards, mailbox ownership, rate limits and reply parent authorization remain in force.
- Extend the in-process send facade and the compose command with optional context for this workflow. Existing `POST /api/communication_channels/send-as-user` requests retain their existing references and no ownership transfer.
- Use the hub's existing count cap and each adapter's type and size capabilities. Adapters can advertise a lower count limit. Apply the same validation to uploaded files regardless of how the composer identified them.

## Migration & Backward Compatibility

The existing request fields become usable together on an explicitly chosen mailbox. The in-process options are additive. The platform sender, draft workflow, direct send-as-user HTTP clients, provider interfaces and stored historical outbound refs retain their existing behavior. Reverting the implementation leaves sent records, moved files and queued refs readable by the existing hub.

## Resolved assumptions (autonomous defaults)

| Question | Decision | Rationale |
| --- | --- | --- |
| Which owner should delivery use? | Move temporary compose uploads to the sent message and use that owner for worker reads. | Keeps the sent copy complete and reuses the existing message and attachment model. |
| Where should linked records appear? | Keep records as in-app message objects. | Record identifiers and action metadata are internal workspace context. |
| Should files and records ship together? | Deliver both on the existing composer flow. | The issue asks for one mailbox compose to carry both and they share one delegation and persistence boundary. |

## Risks & Impact Review

| Scenario | Severity | Mitigation |
| --- | --- | --- |
| A user selects a file outside the compose session or organization | High | Bind IDs to the temporary owner and exact tenant and organization. Use scoped reads and condition the transactional move on that same owner. |
| A file is deleted or reassigned between validation and compose | High | Roll back the compose when the move does not match all validated rows. |
| The channel-link write fails or the queue is unavailable | Medium | Roll back the compose and moves if the link write fails. Enqueue only after commit and preserve the durable link and sent copy on queue failure. |
| A provider rejects a size or MIME type, or a file is missing at delivery | Medium | Use hub preflight before write and the existing retry or terminal failure policy after enqueue. Preserve the attached files and objects in the sent copy. |
| Linked record types are tied to the original composer message type | Medium | Validate with that original type without replacing the stored channel type. |

## Integration Coverage

- Extend `TC-CHANNEL-EMAIL-HUB-004.spec.ts` with an isolated linked CRM record, temporary upload and owned seeded mailbox. Send through `POST /api/messages` and verify the detail response, attachment ownership, outbound references and thread mapping. Use fixtures and clean them up.
- Cover rejection when a file does not belong to the submitted compose record, and keep coverage for the plain platform path and the mailbox ownership boundary.
- Use unit tests for the two provider paths' existing attachment delivery contract, the delegation payload, and the new reference owner and command validation behavior. Verify the composer submits both payload fields while keeping the current controls.

## Final Compliance Report

The design uses the existing message command, module boundary, attachment access checks, resource scope, and adapter policies. Validation will bind the accepted request, persisted message and outbound link to the same test fixture. A live provider is unnecessary for integration tests that inspect queued references.

## Changelog

- 2026-11-22 — Proposed attachment and linked-record support for the existing mailbox composer.

## Implementation Plan

### Phase 1 — Characterize and implement the compose payload

1. Run the current sender-delegation characterization covering the 422 for uploads and records. Confirm the current behavior separately from the implementation diff.
2. Pass the temporary owner and linked records through composer delegation. Extend the in-process hub and compose command context, including a guarded transactional move and updated outbound refs. Update focused unit coverage.
3. Extend the connected mailbox integration scenario, validate the existing composer controls and run the repository validation gate.

### Phase 2 — Archive the behavior

4. Archive the Delta in `.ai/specs/capabilities/connected-mailbox-compose.md` when implementation ships.
