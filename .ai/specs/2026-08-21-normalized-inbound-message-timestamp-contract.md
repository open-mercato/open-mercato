# Normalized Inbound Message Timestamp Contract

## 📝 TLDR

Inbound channel adapters expose one canonical nullable `timestamp` for application behavior and may additionally expose the provider-native `providerTimestamp`. Email adapters select the canonical timestamp using MIME `Date`, then provider internal time, then `null`; other adapters select the best meaningful occurrence time for their channel. Open Mercato materialization time remains the entity `createdAt` and is never substituted for an unknown external time.

This focused specification records the simplified contract chosen after issue #5326 proposed separate source and provider timestamps. It preserves the existing `timestamp` field for third-party adapter compatibility while retaining provider provenance when a channel supplies it.

## 📝 Overview

The contract spans the communication hub's public adapter type, first-party Gmail and IMAP providers, internal message persistence, and provider-side anchor records. It does not redesign channel delivery, introduce database fields, or change event IDs. The goal is to represent unknown time honestly while preserving useful provider metadata without forcing every channel into email-specific source semantics.

## 📝 Problem Statement

`NormalizedInboundMessage.timestamp` previously required a `Date`, which encouraged adapters and consumers to replace an unknown external time with local normalization time. Imported historical messages could therefore appear to have been sent when Open Mercato happened to import them.

Issue #5326 initially proposed required, separate `sourceTimestamp` and `providerTimestamp` fields. That model preserves maximum provenance but expands every channel adapter contract even though many providers expose only one authoritative message time. The adopted contract keeps the established canonical field nullable and adds only an optional provider-native field.

## 📝 Proposed Solution

`NormalizedInboundMessage` has the following timestamp contract:

```ts
interface NormalizedInboundMessage {
  /** Best meaningful occurrence time selected by the adapter; null when unknown. */
  timestamp: Date | null

  /** Provider-native storage or delivery time when separately available. */
  providerTimestamp?: Date | null
}
```

The canonical `timestamp` drives application behavior such as `Message.sentAt`, message ordering, conversation summaries, CRM occurrence time, forwarding, and user-facing date labels. It does not promise a universal provenance beyond being the adapter's best meaningful external occurrence time.

Provider adapters define their own selection policy. First-party email adapters use:

```text
valid MIME Date → valid provider internal date → null
```

They independently expose the valid Gmail `internalDate` or IMAP `INTERNALDATE` as `providerTimestamp`, even when MIME `Date` wins the canonical selection. Non-email providers may return the same value for both fields when their native message timestamp is also the canonical occurrence time, or omit `providerTimestamp` when no separate transport fact exists.

The persistence mapping is:

| Normalized value | Destination | Meaning |
|---|---|---|
| `timestamp` | `Message.sentAt` and derived application projections | Best meaningful external occurrence time |
| `providerTimestamp` | `ExternalMessage.providerTimestamp` | Provider-native transport/storage time only |
| neither | Entity `createdAt` | Local Open Mercato materialization time |

`createdAt` is not a fallback for either external timestamp.

## 📝 Architecture

The provider package owns extraction of provider-native facts. The shared MIME normalizer validates MIME and fallback dates, selects the canonical value, and carries the validated fallback separately as `providerTimestamp`. The communication hub persists the two values into their distinct module-owned entities.

No new database column, event, API endpoint, or cross-module relationship is introduced. `ExternalMessage.providerTimestamp` retains its existing provider-specific meaning.

## 📝 Data Model

No schema migration is required:

- `messages.sent_at` remains nullable and stores the canonical occurrence time.
- `external_messages.provider_timestamp` remains nullable and stores only the provider-native time.
- each entity's `created_at` remains local materialization metadata.

Historical rows are not backfilled. Existing `messages.sent_at` or `external_messages.provider_timestamp` values may have ambiguous provenance and must not be reclassified without retained evidence.

## 📝 API Contracts

`NormalizedInboundMessage.timestamp` remains required but widens from `Date` to `Date | null`. Existing adapters returning `Date` remain valid. Consumers must handle `null`.

`NormalizedInboundMessage.providerTimestamp` is additive and optional. Existing third-party adapters do not need to change. Adapters that can distinguish provider-native time should populate it.

No public HTTP request schema gains authority to set `Message.sentAt`; internal ingest commands own imported timestamp persistence.

## 📝 UI/UX

User-facing surfaces render the canonical timestamp when present and a translated “Unknown date” fallback otherwise. Local `createdAt` may be shown separately only when a surface explicitly presents import or diagnostic metadata.

## 📝 Edge Cases & Failure Scenarios

- Invalid MIME dates are ignored without throwing.
- Invalid provider dates are ignored and exposed as `null`.
- A valid MIME date and a different valid provider date are both preserved: the MIME date is canonical and the provider date remains diagnostic metadata.
- When only provider time exists, it supplies both the canonical occurrence time and `providerTimestamp`.
- When neither exists, both values are `null`; local import time is not substituted.
- Replay and dedup continue to use `(channelId, externalMessageId)`, not timestamps.

## 📝 Risks & Impact Review

The main risk is consumers assuming that canonical `timestamp` always has one provenance. Its contract deliberately promises only the adapter's best meaningful occurrence time. Code requiring provider-native time must read `providerTimestamp` instead.

Rollback is additive: consumers may ignore `providerTimestamp`, and first-party adapters can stop populating it without schema rollback. Reverting nullable canonical timestamps would reintroduce fabricated dates and is not a supported compatibility direction.

| Severity | Failure scenario | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| High | A consumer dereferences nullable `timestamp` without a guard | Third-party adapters and projections | Type widening, focused tests, upgrade notes | Untyped downstream consumers can still fail at runtime |
| Medium | Canonical MIME time is incorrectly persisted as provider-native time | Diagnostics and provider reconciliation | Separate optional field and explicit persistence mapping | Legacy stored rows retain ambiguous provenance |
| Medium | An adapter substitutes local import time | Ordering and user-visible dates | Contract text, first-party tests, translated unknown-date state | Third-party adapters remain responsible for compliance |

## Migration & Backward Compatibility

- Keep `NormalizedInboundMessage.timestamp`; do not replace it with required source/provider fields.
- Widening `timestamp` to `Date | null` requires consumers to handle unknown values but does not break adapters that always return `Date`.
- Add `providerTimestamp?: Date | null` as an optional field, so existing adapters compile unchanged.
- Keep `ThreadMatchInput.receivedAt?: Date` as a deprecated, ignored bridge for at least one minor release. Callers may remove it immediately; the field can be removed only after the repository's deprecation window and upgrade-note requirements are satisfied.
- Do not rewrite historical timestamp data without provenance evidence.
- Document the contract and removal timing in `UPGRADE_NOTES.md`.

## 📋 Phasing

### Phase 1 — Contract and first-party adapters

Document the contract, add the optional provider timestamp, preserve the deprecated thread-matcher input, and update Gmail/IMAP normalization and hub persistence.

### Phase 2 — Consumer hardening

Ensure every affected projection, ordering path, and UI handles nullable canonical timestamps. This work may ship in focused commits while retaining the contract established in Phase 1.

## 📋 Implementation Plan

1. Add the optional provider timestamp to the shared interface and validator, and retain the deprecated thread-matcher field.
2. Preserve validated Gmail and IMAP internal dates through shared MIME normalization.
3. Persist canonical and provider-native timestamps to their designated entities.
4. Add focused regression coverage for MIME/provider precedence, unknown values, persistence, and the compatibility bridge.
5. Update upgrade notes and the tracking issue to record that this specification supersedes the original split-field proposal in #5326.

## Final Compliance Report

- Public contract changes are additive except for the already-documented nullable widening of `timestamp`.
- The removed `ThreadMatchInput.receivedAt` field is restored as a deprecated optional compatibility bridge.
- No API route, event ID, database schema, DI key, ACL feature, or generated-file contract changes.
- Provider-specific extraction remains in provider packages; shared normalization contains only channel-neutral validation and selection behavior.
- Tenant and organization scoping are unchanged.
- Historical data is not reclassified without provenance evidence.

## Changelog

- 2026-08-21: Initial focused specification recording the simplified nullable canonical timestamp and optional provider-native timestamp contract agreed for #5326 and PR #5446.
