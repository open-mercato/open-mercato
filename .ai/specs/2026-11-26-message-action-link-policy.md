# Message-supplied action links

Extends: .ai/specs/implemented/SPEC-002-2026-01-23-messages-module.md

## TLDR

Message composers use relative destinations for action buttons. Recipients can follow actions that resolve to a relative link, including actions from messages sent before the change.

## Overview

Messages support link actions supplied by a composer and actions registered by a module for a message type or an attached object.

## Problem Statement

The generic rich-text URL sanitizer accepts external destinations for links in ordinary content. A recipient who clicks a message-supplied action expects the application to handle it. Allowing off-origin destinations in that action breaks this boundary.

## Proposed Solution

Use a shared Messages validator for action links at composition and draft update. Resolve stored actions through the same validator after encoding template values. Registered message-type and object-type actions continue using the rich-text sanitizer.

## Architecture and Data Model

The Messages module owns the policy. Its existing Zod request schemas and action resolver enforce it at the two relevant boundaries. Action provenance comes from the existing server-side resolver, which records whether the action came from the message or a module registration.

Stored messages and drafts keep their current representation. Deployment, application settings and dependencies stay the same.

## API Contracts

| Existing endpoint | Expected behavior |
| --- | --- |
| `POST /api/messages` | Admits relative message action destinations. An invalid destination fails input validation before the message is persisted. |
| `PATCH /api/messages/:id` | Admits the same destinations when updating a draft. An invalid destination fails validation before the draft is changed. |
| `POST /api/messages/:id/actions/:actionId` | Returns a redirect for a valid resolved link. Invalid stored message destinations fail before returning a redirect or recording a completed action. |

Relative paths, queries and fragments remain supported. The existing rich-text restrictions still apply. The policy permits ordinary links in the message body under the existing rich-text rules.

## Migration & Backward Compatibility

This narrows accepted message action destinations in the stable compose and draft API contract and in the exported action validator. Execution applies the same policy to existing stored data. Retaining the previous off-origin destination behavior during a deprecation period would preserve the behavior addressed by this fix.

Client integrators should replace external button destinations with relative destinations and put any intended external link in the message body. Operators can leave stored messages in place. Replace off-origin actions in existing drafts before sending, and send a replacement message when recipients need a corrected action.

The [compatibility ledger](../../BACKWARD_COMPATIBILITY.md#2026-11-26--message-supplied-action-links-3487) and [upgrade notes](../../UPGRADE_NOTES.md#message-supplied-action-links-3487) record the exception and migration. A named maintainer must approve the Emergency Security Exception before merge.

## Risks & Impact Review

- Older off-origin actions are unavailable after upgrade. Send a replacement message when an action still needs to be completed.
- A restriction applied to module registrations would break their existing links. The action resolver applies the new policy based on server-assigned provenance.
- Compose-time validation alone leaves earlier actions exposed to the old behavior. Execution checks the destination after template resolution.

## Verification

The Messages validator, resolver, execute command, draft command and action route unit suites cover the existing entry points and link policy. Browser QA should confirm that a recipient can follow a valid message action from the inbox. Independent review and human QA are merge gates.

## Final Compliance Report

The behavioral change is confined to Messages action input validation and execution. The server still checks access and applies existing command guards. The compatibility exception is awaiting human sign-off.

## Changelog

- 2026-11-26 — Documented the link policy, affected endpoints and upgrade path for issue #3487.
