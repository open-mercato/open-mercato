# CRM record creation provenance

## 📝 TLDR

Add immutable creator attribution to people, companies and deals for issue #7700. The server records the authenticated human actor when known; existing/imported records with no evidenced creator remain null. This additive metadata capability is independent of every other [Phase 1 slice](2026-10-22-crm-field-model-phase-1.md).

## Overview and Problem Statement

`owner_user_id` identifies current responsibility, not who created the record. Reassignment must not erase provenance. Baseline is `main` `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`, reviewed 2026-10-22. Existing command audit remains the detailed action history; this field is a convenient stable attribution, not a substitute log.

## Resolved assumptions (autonomous defaults)

Existing rows receive null. API keys/service actors receive null unless the existing authenticated command context explicitly identifies a human acting on the request; never substitute owner, importer, earliest available audit entry or migration operator. No caller can assert another user's creator ID. These defaults are reversible additions and do not invent historical facts.

## 📝 Proposed Solution and Architecture

Add `created_by_user_id` to `CustomerEntity` and `CustomerDeal` in customers. Creation commands for people, companies and deals derive it from trusted auth context. Record the ID only, without direct ORM relation to auth. Undo restores the original creator on restored records; clone creates a new record with the cloner's actor. Service-token delegation follows existing trusted actor semantics, never arbitrary body metadata. Public edit validators do not expose this field as writable.

## 📝 Data Model and API Contracts

Both columns are nullable UUID; no index until a real creator-filter use case exists. Add `createdByUserId: UUID|null` to `/api/customers/people`, `/companies`, `/deals` list and detail responses, including existing single-record routes and query-engine serialization; preserve all existing names/types/envelopes. Require existing parent view ACLs. A public create/update `createdByUserId` input must not overwrite server authority; preserve route passthrough compatibility by ignoring it rather than tightening unrelated existing schemas. Document it as response-only in OpenAPI.

This is personal attribution metadata: scope reads to the parent tenant/organization and avoid returning expanded user profile data. Use existing user-reference privacy handling; no copied email/name, raw audit text or new search vector. Because this is an opaque relational identifier, encrypting it would obstruct the same UUID-reference convention already used by owner IDs; no new encrypted free-text column is introduced.

## 📝 UI/UX

Show Created by in the existing detail metadata section only where the viewer can resolve that user through the existing user picker/reference API. If unresolved/deleted or unavailable, use localized Unknown creator without revealing an inaccessible user's name. Never put this immutable field in edit forms. Reuse server detail data and existing reference component; no new client island, bootstrap provider or browser library. Route hydration/read-only visibility tests cover all three details.

## Migration & Backward Compatibility

Add nullable columns and module snapshot; no attribution backfill and no new required request field. Existing creation/update payloads and parent optimistic-lock behavior remain. On undo/restore retain captured creator; post-commit indexing/cache invalidation uses existing command flows. Disable the detail field for rollback while retaining data; no destructive down after production writes. Implementation updates upgrade notes for the additive response field and runs discovery generation as needed.

## 📝 Risks & Impact Review

Spoofed body attribution is prevented by trusted server assignment and immutable update handling. Cross-org user-name disclosure is prevented by existing reference authorization; the stored UUID is not permission to fetch the user. Import provenance remains incomplete where no original actor exists, deliberately represented by null. A command path omitted during implementation would silently lose attribution, so the test matrix includes direct commands, UI/API, AI-approved create, fixture/import and clone paths that actually exist at implementation head.

## Integration Coverage and Final Compliance Report — 2026-10-22

Add fixtures for human, API-key, reassigned, restored, cloned and pre-migration records. Assert all three CRUD list/detail routes include the nullable read-only field, forged create/update body values cannot set/change it, existing clients still work, and same-tenant cross-org reads fail. Run each existing create entry point and confirm audit actor/creator agreement. UI tests verify creator/unknown display and unauthorized/deleted-user handling. Self-contained fixtures clean up in finally. Root/core/customers/shared/UI/QA and backward-compatibility rules are addressed; this document claims no executed runtime tests.

## Changelog

- 2026-10-22: Initial independent provenance slice with null historical defaults and server-only attribution.

## 📋 Implementation Plan

### Phase 1 — Additive creator attribution

1. Add nullable fields/migration/snapshot and trusted create-command mapping, covering all existing call sites with same-change integration tests; old update flows continue unchanged.
2. Add read projections/OpenAPI and detail metadata; test forged inputs, old rows, restore/clone semantics and route hydration. Finish the shared validation gate without attributing unknown history.
