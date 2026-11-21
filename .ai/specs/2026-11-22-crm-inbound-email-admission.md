# CRM admission for inbound email

## TLDR

Recurring inbound email enters Open Mercato when the sender is a CRM person in the channel's tenant and organization or the email matches an existing thread in that channel. A deliberate skip consumes the provider message without storing it. Operators can still run an explicit history import.

## Overview

The shared ingest command serves incremental Gmail and IMAP sync, webhooks, and direct callers. Add the admission rule there so every entry point applies the same policy. [Issue #5468](https://github.com/open-mercato/open-mercato/issues/5468) · [Inbound reliability and threading](implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md)

## Problem Statement

The command creates or updates a provider conversation before checking whether it can match the sender or thread. The existing contact resolver is advisory and may return an adapter hint or miss encrypted CRM addresses. Using that hint to admit mail would lose valid CRM email or retain unrelated mail.

## Proposed Solution

Use the stored channel type to apply admission to email. Preserve duplicate detection and use the existing scoped thread matcher and provider conversation mapping to find an existing platform thread. An external conversation with no mapped thread gives no evidence of a reply. Resolve the sender against active CRM person records in the same tenant and organization. A missing MIME From address cannot qualify through the mailbox account that the normalizer uses as a fallback sender identifier.

When neither test admits a message, return `{ status: 'skipped' }` before creating, updating, or composing any records. A skip emits no events and leaves no dead letter or message diagnostic. The poll and Gmail history-sync workers already consume fulfilled ingest results when advancing a cursor. Treat failed admission reads as retryable so a failed read cannot discard a valid message or persist its payload in the dead-letter store.

The operator history worker marks its trusted runtime context so the same command ID and interceptors continue to serve that flow. Ordinary command payloads carry no admission override. Existing behavior for non-email channels uses the advisory resolver.

## Architecture

`communication_channels` resolves an optional email contact lookup through DI. `customers` registers the implementation with job or request scope. It uses the existing address normalization and `findWithDecryption` to read scoped, non-deleted people in bounded pages. Share the address lookup within one job and exact tenant and organization scope. Do not use a fixed total row cap that would treat older known senders as unknown. When Customers is disabled or the channel lacks an organization, thread evidence remains available.

Keep the complete incremental provider feed. Gmail history filters by label and event type. IMAP sender search would omit unknown senders whose replies match by headers, body token, or provider thread. The optional `contactFilter` remains available to implementations that can preserve all reply candidates. Existing operator import can continue to use provider-side filtering. [Gmail history API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list) · [IMAP SEARCH](https://www.rfc-editor.org/rfc/rfc9051.html#section-6.4.4)

## Data Models

Use the existing CRM person email, channel, external conversation, and thread mapping records. The address lookup is held in memory for its request or worker job. A skip creates no record to undo.

## API Contracts

`communication_channels.message.ingest_inbound` gains an additive `skipped` status with no record IDs. Its payload and existing `created` and `duplicate` results retain their shapes. `POST /api/communication_channels/channels/{id}/poll-now`, Gmail push, and ordinary webhook processing apply the policy through the workers. `POST /api/communication_channels/channels/{id}/import-history` retains explicit import behavior. Provider inputs, cursor formats, event IDs, and HTTP response shapes stay compatible.

## Migration & Backward Compatibility

No schema or configuration migration is required. Existing messages remain accessible. Document in `UPGRADE_NOTES.md` that ordinary inbound email skips unrelated messages and custom command result handlers may observe `skipped`. Existing provider adapters require no changes.

## Implementation Plan

### Phase 1 — Shared admission

1. Add the scoped CRM lookup and apply it alongside existing thread matching before the first write. Keep the operator history scope on its worker context.
2. Cover known and unrelated senders, matching replies, exact tenant and organization scope, encrypted and older contacts, duplicate and repeat skips, and retryable lookup failure. Assert that skips do not write, compose, or emit.

### Phase 2 — Entry-point verification

1. Cover skipped production command outcomes through the poll worker for IMAP and Gmail and through the Gmail push history worker. Exercise a later message and a retryable failure to verify cursor behavior.
2. Exercise the real command with a scoped CRM fixture in the existing Playwright test harness. Preserve existing history import and reply coverage with isolated fixtures and add the upgrade note.

## Risks & Impact Review

| Failure | Impact | Mitigation |
| --- | --- | --- |
| Contact or thread lookup fails | High. Advancing the page would lose an eligible message. | Raise a retryable admission error and let the workers keep the starting cursor. |
| Sender exists only outside the channel scope | High. Unrelated mail would enter the wrong inbox. | Match by exact tenant and organization. Use scoped channel mappings for reply evidence. |
| A provider filters out an unknown reply | High. It cannot reach the shared matcher. | Preserve the full incremental feed and verify subsequent cursor reads. |
| An encrypted organization has many contacts | Medium. Admission can delay the first unthreaded email in a job. | Use a narrow, paged read once per scope and job. This still reads the full address set for that scope. |

## Final Compliance Report

The design uses the command bus, optional DI, scoped decryption reads, and existing event and thread contracts. It changes no rendered surfaces, schema, ACL grants, or provider credentials. Implementation gates cover worker cursors, API-backed ingest, and the existing history import and compose regressions.

## Changelog

### 2026-11-22

- Specified inbound admission and cursor semantics for issue #5468.
- Independent scope review confirmed that the admission decision, history exception, and cursor behavior form one deployable capability.
