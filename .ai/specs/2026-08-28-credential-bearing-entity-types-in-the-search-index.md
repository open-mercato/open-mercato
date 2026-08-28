# Credential-bearing entity types in the search index

## TL;DR

Nothing stops a credential table being written into `entity_indexes` and
`search_tokens`. `mercato query_index reindex` with no `--entity` sweeps every
generated entity id, so a stock deployment indexes `auth:session`,
`auth:password_reset`, the four `customer_accounts` token tables,
`communication_channels:channel_thread_token`, `messages:message_access_token`
and the `security` module's MFA and sudo tables. `buildIndexDocument()` copies
the base row into `doc` verbatim, so the credential is stored whatever the field
blocklist says, and the row's non-blocklisted columns — a session's `ip_address`
and `user_agent`, a sudo session's `target_identifier` — are tokenised and become
searchable. A shared `isIndexableEntityType()` now refuses those entity types at
the four places that write, and `registerNonIndexableEntityTypes()` lets code
this package cannot name add its own.

## Overview

- **Changed**: `packages/shared/src/lib/entities/system-entities.ts` — the
  refusal list, `isIndexableEntityType()`, `registerNonIndexableEntityTypes()`,
  `listNonIndexableEntityTypes()`, `resetNonIndexableEntityTypes()`
- **Changed**: `packages/core/src/modules/query_index/lib/indexer.ts`,
  `.../batch.ts`, `.../search-tokens.ts`, `.../reindexer.ts` — one guard each
- **Not touched**: `isSearchFieldBlocklisted()` and the field-level blocklist
  (#4624), `RESERVED_SYSTEM_ENTITY_TYPES` and the enumeration helpers built on
  it, the custom-field-definition API, the readers in `@open-mercato/search`,
  the `entity_indexes` schema. No migration.

## Problem statement

Three separate facts combine.

**1. Nothing gates which entity types may be indexed.** The
`query_index.upsert_one` subscriber indexes whatever entity type the event
names. `reindexEntity()` refuses an entity type that does not resolve to
registered ORM metadata (#2705) and refuses `query_index:search_token` by name,
and that is the whole of it. `mercato query_index reindex` and
`mercato query_index rebuild-all`, invoked without `--entity`, iterate
`flattenSystemEntityIds(getEntityIds())` — every generated entity id, minus the
seven in `RESERVED_SYSTEM_ENTITY_TYPES` — and reindex each in turn. Credential
tables are in that set.

**2. The field blocklist governs the tokens, not the stored document.**
`buildIndexDocument()` opens with

```ts
for (const [key, value] of Object.entries(baseRow)) {
  doc[key] = value
}
```

and `isSearchFieldBlocklisted()` is consulted afterwards, by
`collectAggregateSearchValues()` for the `search_text` aggregate and by
`shouldIndexField()` for the token rows. So #4624 stopped a blocklisted column's
text coming back into `search_tokens` under the aggregate's name — it did not
stop the column being copied into `entity_indexes.doc`. Unless the entity
declares payload encryption, `doc->>'token'` on an indexed `auth:session` row is
the session token, and `doc->>'secret'` on an indexed MFA row is the shared
secret.

**3. The columns that are not blocklisted are tokenised.** The blocklist matches
field names against `password`, `token`, `secret`, `hash`. A credential table's
*other* columns do not match:
`customer_accounts:customer_user_session` contributes `ip_address` and
`user_agent`; `security:sudo_session` contributes `target_identifier`;
`customer_accounts:customer_user_invitation` contributes `email` and
`display_name`. Those become searchable rows in `search_tokens` — a membership
and session-metadata oracle for anyone who can reach global search.

Compounding all three: several of these tables have no `tenant_id` column, so
their index rows are filed under whichever tenant last ran a reindex. That is a
separate defect with a separate fix (`reindexEntity()`'s tenant-scope guard);
neither subsumes the other, and this one holds for the credential tables that
*do* have a tenant column.

**How it was found.** Auditing a production deployment's `entity_indexes` and
`search_tokens` after a support question about odd global-search results. Every
indexed session row carried its token in the stored document; on that
deployment — which predates #4624 — the aggregate had copied it into
`search_text` as well, and `search_text` was the only field producing tokens for
those entity types, so the tokens were of the credential itself. #4624 closes
that last part. It does not close the other two.

## The fix

`isIndexableEntityType(entityType)` in
`packages/shared/src/lib/entities/system-entities.ts`, enforced at four write
chokepoints:

| Chokepoint | Behaviour | Why there |
|---|---|---|
| `buildIndexDoc()` | returns `null` | `upsertIndexRow()`'s null branch already deletes the projection row **and** its search tokens, so an index polluted by an earlier release cleans itself up as records are touched, rather than merely stopping the bleeding |
| `upsertIndexBatch()` | returns an empty batch result | the batch path never goes through `buildIndexDoc`; `rebuild-all` calls it directly. Empty rather than a throw, so the CLI's `assertIndexBatchWritesLanded()` reads 0 written of 0 attempted and the sweep continues |
| `buildSearchTokenRows()` | returns `[]` | an empty row set rather than a short-circuit in the callers, so `replaceSearchTokensForRecord` / `...ForBatch` still run their `DELETE` and stale tokens are removed |
| `reindexEntity()` | empty result + warning | a reindex that got past this point would prepare a job, reset coverage and purge rows for an entity type that must not be in the index at all. Subsumes the `query_index:search_token` literal that was there |

The four are belt and braces on purpose: `reindexEntity` covers the sweep,
`buildIndexDoc` the event path, and the other two are for callers that batch or
tokenise directly.

## Why a list, and why also a registration seam

The two shapes fail in opposite directions, and that decides the design.

`registerTenantGlobalEntityTypes()` is an **allowlist**: an entity type nobody
declares fails closed, and the cost of forgetting is a search result that does
not appear plus a warning naming the entity type. Registration can therefore be
the whole mechanism.

This is a **denylist**: an entity type nobody declares fails open, and the cost
of forgetting is a credential in a searchable table, silently. So registration
cannot be the whole mechanism. Three consequences:

1. The built-in list is authoritative and names every credential entity type in
   this repository, including those in packages `shared` does not depend on.
   Bare strings need no import, and `RESERVED_SYSTEM_ENTITY_TYPES` in the same
   file already names entity types from `core` on the same basis.
2. `registerNonIndexableEntityTypes()` is an escape hatch for applications and
   out-of-tree packages, additive only — it can widen the refusal, never narrow
   it.
3. A registration that lands after the first index write has already lost, so
   the seam is documented as a module-load-time call. An allowlist has no such
   ordering hazard; this one does.

A per-entity declaration (`@Entity({ indexable: false })`, or a flag in a
module's `search.ts`) was considered and rejected for the same asymmetry: it
puts the decision where it is easiest to forget, and a credential table added
without the flag is indistinguishable from one that was reviewed.

## Where the list came from

Every `@Entity` class in this repository was enumerated from its module's
`data/entities.ts` (262 of them) and its property names matched against
`token|secret|password|hash|code|key|credential|otp|nonce|signature`, then again
by class name. The admission test is **"is holding a bearer credential, or the
verifier for one, the row's reason to exist?"** — not "does it contain a
secret". Twelve entity types clear it:

| entity type | package | the credential |
|---|---|---|
| `auth:session` | core | `token` |
| `auth:password_reset` | core | `token` |
| `customer_accounts:customer_user_session` | core | `token_hash` |
| `customer_accounts:customer_user_password_reset` | core | `token` |
| `customer_accounts:customer_user_email_verification` | core | `token` |
| `customer_accounts:customer_user_invitation` | core | `token` |
| `communication_channels:channel_thread_token` | core | `token` |
| `messages:message_access_token` | core | `token` |
| `query_index:search_token` | core | the index's own token table; indexing it is a feedback loop |
| `security:sudo_session` | enterprise | `session_token` |
| `security:mfa_challenge` | enterprise | `otp_code_hash` |
| `security:mfa_recovery_code` | enterprise | `code_hash` |

Deliberately **not** on it, because each holds a secret column *and* backs a
list screen with fields a person searches for — removing them from the index
breaks their own screens, and the field-level blocklist is what protects them:
`api_keys:api_key`, `integrations:integration_credentials`, `sso:sso_config`,
`sso:scim_token`, `security:user_mfa_method`, `inbox_ops:inbox_settings`,
`webhooks:webhook_entity`, `checkout:checkout_link_template`,
`payment_gateways:gateway_transaction`, `onboarding:onboarding_request`,
`devices:user_device`. Also excluded, on the same test applied to closer calls:
`record_locks:record_lock`, `attachments:attachment_quota_reservation`,
`payment_gateways:gateway_session_initialization`,
`payment_gateways:gateway_payment_operation`,
`warranty_claims:warranty_claim_sla_signal` — operational records whose token is
a coordination claim rather than the row's reason to exist.

`customer_accounts:customer_user_invitation` is the closest call on the other
side. It carries `email` and `display_name`, which an admin might reasonably
want to search. It is refused anyway: its `token` grants an account to whoever
presents it, and no first-party screen lists invitations through the query
index — the module manages them through `customerInvitationService`.

## What this does not fix

- **The stored document still carries blocklisted fields for every entity type
  that stays indexed.** `api_keys:api_key`'s `key_hash` and
  `security:user_mfa_method`'s `secret` are in `entity_indexes.doc` after this
  change exactly as before it. Stripping blocklisted fields from the document,
  rather than only from the aggregate and the tokens, is the separate and larger
  change; this one removes the entity types for which the document has no
  legitimate content at all.
- **Rows written by earlier releases are not migrated.** They are removed
  opportunistically: `buildIndexDoc()` returning null makes `upsertIndexRow()`
  delete the projection row and its tokens the next time the record is touched,
  and `mercato query_index reindex` purges each entity type before refusing it.
  Operators who want them gone now should run that command; see
  `UPGRADE_NOTES.md`.
- **The AI assistant's in-process search** resolves `searchService` from DI and
  never reaches these writers; it reads whatever is in the index. It is
  unaffected because the rows stop existing, not because it was gated.

## Tests

`packages/core/src/modules/query_index/__tests__/credential-entity-denylist.test.ts`
— 37 cases: the policy itself (each refused type, each deliberate exclusion,
normalisation, the registration seam and its reset), and one case per chokepoint
with a matching negative control proving an ordinary entity type still gets
indexed, still produces tokens, and still reaches its source table.

Non-vacuity was measured, not assumed. With the policy module present but the
four guards reverted, exactly four cases fail — one per chokepoint — and the
other 33, the negative controls included, pass.
