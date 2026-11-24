# Trusted shared mailbox sending

- Status: Proposed
- Issue: #7100
- Extends: `.ai/specs/2026-05-21-email-integration-foundation.md`

## TLDR

An in-process caller can authorize an employee to send through another employee's connected mailbox. Gmail can display the acting employee's name next to the connected mailbox address.

## Overview

A team can work an address such as `orders@` while the employee who connected it retains the OAuth grant. Open Mercato attributes the outgoing message to the employee who wrote it. The caller supplies the team membership policy. The broader department-mailbox proposal is tracked in #6293 and thread reassignment in #10270.

## Problem Statement

`sendAsUser` currently requires the channel owner to be the acting user, even when the caller has already confirmed access to a shared mailbox. The Gmail MIME converter accepts a display name, but the delivery pipeline does not supply one.

## Proposed Solution

- Accept an optional `SendAsUserOptions.authorizeNonOwner` callback as a fourth argument to `sendAsUser`. The existing DI registration exposes the same function. Call the policy only for a non-owner and pass the actor plus the resolved channel ID, owner ID, provider and channel type. Require an explicit `true` before continuing.
- Resolve the active tenant and organization from the actor, and resolve the channel in that scope before consulting the caller. Refuse an ownerless channel before any policy or write. Preserve the existing status and mutation checks.
- Read `channelMetadata.fromName` in the Gmail converter when an explicit name is absent. Collapse line breaks and tabs, escape quotes and backslashes using the existing helper, and carry the normalized name through both Gmail conversion passes. Use the address from the mailbox credentials at delivery. When older credentials lack an address, use the authenticated Gmail profile’s validated address. Fail the send if no valid mailbox address can be established.

## Architecture

The in-process caller owns the membership check. The hub owns tenant and organization scope, channel mutation guards, composing and queuing. The compose command continues to record the actor as the sender. The delivery command resolves and refreshes credentials under the connected channel owner. For attachments, both the facade and delivery check read access as the message sender. Delivery reads that identity from the persisted message.

## Data Models

Existing `CommunicationChannel.userId`, `Message.senderUserId` and `MessageChannelLink.channelMetadata` carry the identities and display name. No migration or new entity is required.

## API Contracts

`POST /api/communication_channels/send-as-user` and `POST /api/messages` call the facade without the options argument and continue to reject a different owner's channel. The direct endpoint already accepts arbitrary channel metadata. Gmail treats `fromName` as display text and derives the address independently. Request and response schemas and the DI key are unchanged.

The fourth argument is optional and the existing `SendAsUserInput` and result types stay intact. Existing programmatic callers without a callback follow the existing owner-only path.

## Risks & Impact Review

| Risk | Mitigation |
| --- | --- |
| Untrusted requests try to grant sending authority | The authorization argument is supplied only by the in-process call site, after scoped lookup. Denied sends create no rows or queue job. |
| Credentials are written at tenant scope | Require a channel owner even when the caller supplies a policy. Keep the worker's existing channel-owner credential scope. |
| An attachment policy evaluates the wrong employee on retry | Revalidate using the persisted sender on every attempt. A denied attachment fails delivery. |
| A display name changes the mailbox address or adds headers | Collapse line breaks, escape quoted text, and assemble the From header with the credential address. |

## Implementation Plan

1. Add regression coverage for the owner-only default, policy opt-in, ownerless and out-of-scope channels, sender attribution, and the two HTTP entry points.
2. Add the programmatic policy and verify the delivery worker retains mailbox-owner credential scope and checks attachments as the actor.
3. Normalize Gmail display names and verify the actual outgoing MIME header, default behavior, and metadata round trip.
4. Record the shipped behavior in the capability spec and validate the affected packages and existing HTTP integration flows.

## Integration coverage

`TC-CHANNEL-EMAIL-HUB-004.spec.ts` exercises `/api/messages` and `/api/communication_channels/send-as-user` against a self-created channel, including a non-owner sending request with authorization-like JSON fields. `send-as-user-scope.integration.test.ts` uses PostgreSQL to prove cross-tenant and cross-organization rejection before the policy, compose command and writes. The Gmail converter and adapter suites exercise the provider's MIME payload and profile lookup without contacting a live mailbox. There is no new UI flow.

## 📝 Delta

### Capability: shared-mailbox-sending

#### ADDED Requirement: Authorize a programmatic send through a user-owned mailbox

The hub SHALL accept a non-owner send through a connected mailbox when the in-process policy approves the actor in the same tenant and organization. The actor is the message author and the mailbox owner supplies the credentials.

##### Scenario: A colleague replies for the shared mailbox

- WHEN the policy explicitly approves the actor and the scoped channel has an owner
- THEN the send is accepted and the actor is recorded as the author

#### ADDED Requirement: Preserve a named Gmail sender through delivery

Gmail SHALL use the per-message display name in the From header when supplied, keeping the mailbox credential address.

##### Scenario: An employee supplies a display name for a reply

- WHEN a message specifies `channelMetadata.fromName`
- THEN the Gmail message carries the normalized display name and the connected mailbox address

## Final Compliance Report

The authorization option is additive and defaults closed. Existing scoped lookups, mutation guards, credential resolution and persisted message attribution remain the authority for their respective operations. Automated coverage includes HTTP authorization and the delivery path.

## Changelog

- 2026-11-21 — Proposed a per-call authorization policy and Gmail From display names for #7100.
- 2026-11-21 — Added mailbox-profile resolution for legacy Gmail credentials and PostgreSQL scope coverage after implementation review.
- 2026-11-24 — Reconciled prepared display-name metadata with Gmail’s authenticated address lookup for legacy channels.
