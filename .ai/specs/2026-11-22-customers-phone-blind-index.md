# Exact phone lookup for CRM contacts

Issue: #5515
Status: Proposed

## TLDR

Index normalized contact phone digits with the framework’s keyed lookup hash so the existing CRM phone check can find older contacts under tenant data encryption.

## Overview

CRM staff use the existing person phone check during contact creation and editing. The operation compares ASCII digits after stripping formatting. It continues to use the existing CRM person-view permission and allowed organization scope.

## Problem Statement

The phone check searches at most 500 candidates when encryption is enabled. A contact outside that window can be missed, including a plaintext contact created before encryption was enabled.

## Prior spec drift

[The email and domain blind-index spec](2026-09-04-customers-email-domain-blind-index.md) tracks phone lookup separately. At the upstream revision inspected for this spec, the phone route still uses its plaintext SQL path and bounded decrypted scan. The framework already supports a field-specific context and a previous lookup pepper.

## Proposed Solution

Add a private derived column and index, populate it on person writes and backfill, and verify indexed candidates against the decrypted phone. Keep the existing compatibility paths for unindexed rows until rollout completes. Indexed lookups perform work proportional to the number of matching candidates, with no dependency on the age of the contact.

The [Blind Index project](https://github.com/ankane/blind_index) also separates lookup keys by field and backfills in the application. Use the existing Open Mercato hash and decryption helpers. A [PostgreSQL multicolumn B-tree](https://www.postgresql.org/docs/16/indexes-multicolumn.html) can narrow the lookup using the hash and organization predicates even when the session has no tenant filter.

## 📝 Delta

### Capability: crm-person-phone-lookup

#### MODIFIED Requirement: Exact CRM person phone lookup

The system SHALL find an indexed, visible person whose normalized primary phone equals the requested digits, regardless of how many newer contacts exist.

##### Scenario: An older encrypted contact has been indexed

- WHEN a CRM user searches for the exact digits of an indexed, visible person outside the newest 500 candidates
- THEN the response includes a matching person ID and decrypted display name

##### Scenario: A contact changes or clears their phone

- WHEN the current phone value changes or is cleared
- THEN the old digits no longer match that person

Frozen by: `packages/core/src/modules/customers/api/people/check-phone/__tests__/route.test.ts`

## Architecture

- A customer-owned helper normalizes phone digits and applies `hashForLookup` with a context containing the field and organization ID. Use only keyed `v2:` digests on writes and in `lookupHashCandidates` results. A missing active secret leaves new rows unindexed. The previous keyed pepper remains readable during rotation.
- Customer entity lifecycle hooks derive the hash on person create and on a change set that includes the phone or changes its organization, before the framework encryption subscriber seals fields. This covers command writes, undo and redo, and ORM fixtures. Avoid rehashing unmodified or unloaded phone values. The stress-seed bulk writer bypasses ORM hooks and derives the hash explicitly for people, keeping it out of the search-index payload.
- The route queries active and inactive nondeleted people under its existing scope by organization and digest. It decrypts candidates with the framework helper, confirms exact digits, and returns the existing match shape. Skip undecrypted phone envelopes and return a null name if a verified person's display name remains encrypted. A digest is only a candidate selector.
- Keep the plaintext SQL path when encryption is off and the bounded compatibility scan for rows that can be read using the configured decryption policy. With an active lookup secret, restrict the compatibility paths to unindexed rows. Without an active lookup secret, retain the previous fallback scope across both indexed and unindexed rows. When the application explicitly disables decryption, previously encrypted values require re-enabling decryption with their keys.
- The data migration runs with application secrets through a tenant- and organization-scoped backfill command. Page by ID, derive a digest from readable phone data, and use a conditional update against the observed stored phone and hash. This protects concurrent edits and avoids rewriting phone ciphertext, display names, or optimistic-lock timestamps. Report aggregate counts and unreadable rows without recording identifiers or phone data.

## Data Model

`customer_entities.primary_phone_digits_hash` is nullable, hidden from ORM serialization and internal to this lookup. The nonunique B-tree uses the digest and organization as its leading keys. The phone hash is a keyed lookup value. Its visibility is confined to storage and the lookup path.

```mermaid
flowchart LR
    entity_1["CustomerEntity"]
    entity_2["CustomerPersonProfile"]
    entity_2 -->|one-to-one| entity_1
```

## API Contracts

`GET /api/customers/people/check-phone?digits=…` keeps its query schema, required feature, status codes, body and scope. Hashes are absent from API bodies, command snapshots, search documents and logs. Existing person create and update calls accept the same phone formats.

## UI/UX

The existing duplicate-phone control can report an older indexed contact. The release has no visual changes.

## Edge Cases and Failure Scenarios

- Preserve ASCII digit comparison, including leading zeros. Empty, null, or too-short values have no digest. Duplicate digits can select any verified person in scope.
- Legacy plaintext remains eligible for backfill with encryption on or off. When a previously encrypted phone cannot be decrypted, leave the hash untouched, count the row, and retry after restoring key access.
- If a concurrent edit changes the phone or hash, the backfill skips that write. A subsequent run can revisit it. Repeated backfills are idempotent, and a backfill after rotation can recompute rows keyed with the previous pepper.
- The address matcher compares primary email, and the inbox lookup resolves by email and other thread signals. Keep their matching behavior on their existing paths. Inbox person creation uses the normal command and receives the phone hash there.

## Migration & Backward Compatibility

Apply the additive schema migration before deploying writers. Run the scoped backfill with the application's lookup pepper and decryption keys for environments with existing people. Existing rows remain readable during rollout where the compatibility scan can reach them. Confirm the reported unreadable count is zero before assuming full coverage. For pepper rotation, configure the previous pepper, rerun the backfill with the new pepper, then retire the previous one. Older application versions tolerate the additional nullable column. Rerun the backfill after rollback or a rolling deploy with older writers.

## Risks & Impact Review

| Severity | Failure | Mitigation | Residual risk |
| --- | --- | --- | --- |
| High | Phone digits inferred from an unkeyed digest | Persist keyed digests only and bind their context to the organization | Identical values within one organization share a digest |
| High | A stale digest returns a wrong record | Verify phone digits after decryption and enforce existing tenant and organization filters | Out-of-band updates can require reindexing |
| Medium | Historical phone is missed before backfill | Keep compatibility paths and document per-scope rollout and retry | Older unindexed encrypted rows retain the existing bounded behavior |
| Medium | Index creation contends with live writes | Use the migration conventions and schedule around table size | Operators must budget index creation time |

## Resolved assumptions (autonomous defaults)

| Question | Decision | Rationale |
| --- | --- | --- |
| Redirect other matchers? | Keep this change in CRM person phone lookup | The other reviewed matchers have independent matching inputs and policies |
| How to migrate historical data? | Schema migration followed by a scoped application-side backfill | The lookup secret and decryption keys stay in the application |
| How to transition without an index or lookup pepper? | Keep the original behavior for unindexed rows and never store an unkeyed phone digest | Preserves deployments without lookup secrets and protects low-entropy phone data |

## Phasing

1. Characterize the lookup and introduce the additive schema, scoped digest, and write maintenance.
2. Read indexed candidates and backfill historical rows, then verify the complete route.

## Implementation Plan

1. Characterize the current checked behavior, including the 500-row bound, using the route unit test and a scoped fixture.
2. Add the schema migration and snapshot, digest helper, and person write coverage. Test formatted values, clearing, missing secrets, and rotation candidates.
3. Use scoped digest equality and verification in the route. Update the characterization test to require an old indexed match. Cover isolation, stale hits, pepper rotation, indexed-row fallback with no active secret, and a clear phone paired with an unreadable name.
4. Add the scoped backfill, including guarded writes, stats, dry run and operator documentation. Cover plaintext, encrypted, retry, and concurrent edit scenarios.
5. Exercise person creation, update and clearing through the API fixture, and exercise the check-phone route with an indexed historical row and more than 500 newer candidates. Delete all fixtures after each test. Run generated artifacts checks and the configured validation gate.
6. Archive the Delta to `.ai/specs/capabilities/crm-person-phone-lookup.md`.

## Final Compliance Report

The design preserves the phone encryption map, uses existing decryption and keyed lookup helpers, and adds an internal index. Tenant and organization scoping, field serialization, migration drift, and run-time verification remain implementation review gates.

## Changelog

- 2026-11-22. Proposed the CRM person phone blind index and historical backfill for #5515.
