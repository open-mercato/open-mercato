# Blind index for CRM email and company domain

Tracking issue: [#5765](https://github.com/open-mercato/open-mercato/issues/5765)

## 📝 TLDR

`customers/encryption.ts` seals `customer_entities.primary_email` and `customer_companies.domain` with AES-GCM under a per-write random IV, but declares no `hashField`, and neither table carries a companion `*_hash` column. Any exact-value lookup on those columns therefore matches **zero rows** the moment an organization gets an `encryption_maps` row — and for a dedup or inbound-matching probe, zero rows is the normal, expected answer, so the failure is completely silent. This spec adds the blind-index columns the framework already supports everywhere else (`auth:user.email_hash`, `customer_accounts:customer_user.email_hash`, `messages:message.external_email_hash`, `onboarding:onboarding_request.email_hash`), routes the person matcher through them so it stops depending on a 500-row newest-first scan, and adds the company-by-domain helper that does not exist at all today.

## 📝 Overview

Three shipped artifacts, in the order they must land:

1. **Two nullable hash columns** (`customer_entities.primary_email_hash`, `customer_companies.domain_hash`) declared through the framework's existing `hashField` mechanism, plus the migration and indexes that back them.
2. **A map-reconciliation step** — a configs upgrade action that re-seeds the two `encryption_maps` rows for pre-existing tenants. Without it the `hashField` declaration never reaches the runtime, because the field rules are read from the persisted row and not from module code; see [Why the declaration alone is not enough](#why-the-declaration-alone-is-not-enough).
3. **Two readers** — `findPeopleByAddresses` rewritten to a three-arm shape, and a new `findCompaniesByDomains` beside it — followed by an idempotent CLI backfill for rows that predate the change.

Nothing outside the `customers` module changes, no HTTP contract moves, and no write path is edited. The user-visible effect is that exact lookups which silently returned nothing on encrypted organizations start returning the right row.

## 📝 Problem Statement

### The defect

`packages/core/src/modules/customers/encryption.ts` declares both columns as encrypted with no hash companion:

```ts
{ entityId: 'customers:customer_entity',        fields: [ …, { field: 'primary_email' }, … ] }
{ entityId: 'customers:customer_company_profile', fields: [ …, { field: 'domain' }, … ] }
```

`TenantEncryptionSubscriber.beforeCreate` / `beforeUpdate` route every write through `encryptEntityPayload`, which encrypts with `encryptWithAesGcm` — a fresh random IV per write. Two writes of `ada@example.com` therefore produce two different ciphertexts, and `WHERE primary_email = 'ada@example.com'` matches nothing. No error is raised; the query simply returns an empty set.

### Why it is silent, and why it detonates late

`encryptEntityPayload` returns the payload **unchanged** in three cases: the global toggle is off, the (tenant, organization) has no `encryption_maps` row, or no DEK resolves. `encryption_maps` rows are seeded per organization at setup and never reconciled, so on a typical installation most organizations write plaintext and the naive equality predicate works. It breaks only for the organizations that carry a map — decoupled in time and space from the code that is wrong. Neither `primary_email` nor `domain` reads like a secret at the call site, which is what makes the trap effective.

The reporter's concrete case: a CRM export deduped with `lower(primary_email) = lower(?)` and `lower(cc.domain) = lower(?)`, and would have created a duplicate person **and** company for every prospect the moment encryption was enabled for an organization.

### Consequences already visible in core

1. **The person matcher is correct only for the newest 500 rows.** `customers/lib/findPeopleByAddresses.ts` exists solely because of this. It tries direct equality (the fast path, correct only when encryption is off) and then falls back to decrypting `MATCH_CANDIDATE_LIMIT = 500` newest person rows and comparing in memory. A match against an older person is missed, and the miss is indistinguishable from "no such person". Its own doc comment names the missing piece: *"a blind-index (hash) column per field is the follow-up if tenants outgrow it (#5515)"*.
2. **There is no company-by-domain resolver at all.** No core helper resolves a company by `domain`, so every caller that wants one writes the broken predicate itself.
3. **`customer_accounts/subscribers/autoLinkCrmReverse.ts` shows the constraint from the other side.** It reaches a `CustomerEntity` only *by id*, then hashes the decrypted email to search `customer_users.email_hash` — a different table, which does have the column. It never searches `customer_entities` by email, because it cannot.

### The framework already has the answer

Declaring `hashField` makes `encryptFields` write `hashForLookup(value)` beside the ciphertext; readers match with `lookupHashCandidates(value)`, which spans the keyed `v2:` HMAC and the legacy unkeyed digest so the migration window keeps working. Five entities already use it — `auth:user.email`, `customer_accounts:customer_user.email`, `customer_accounts:customer_user_invitation.email`, `messages:message.external_email`, and `onboarding:onboarding_request.email` (`packages/onboarding/src/modules/onboarding/encryption.ts:8`). `customers` has none of them.

The fifth is worth separating from the other four, because it is the exception that explains the next section: `onboarding:onboarding_request` is the only one declared `keyScope: 'system'`, so its rules are resolved from module code and its `hashField` takes effect the moment the literal changes. The other four are tenant-scoped, which means their rules are read from a persisted row — and that is what makes the declaration alone insufficient here.

### Why the declaration alone is not enough

`TenantDataEncryptionService` does **not** read `defaultEncryptionMaps` from module code at write time. `fetchMap` (`tenantDataEncryptionService.ts:229-248`) selects `fields_json` from the `encryption_maps` row for the (entity, tenant, organization) scope, and `encryptFields` iterates those persisted rules — the `if (rule.hashField)` branch at line 417 tests the stored JSON, not the literal in `customers/encryption.ts`. Module code is consulted only for `keyScope: 'system'` maps (constructor, lines 171-175), and neither customers map is system-scoped.

Those rows are written only by `upsertEncryptionMapSpecs` (`packages/core/src/modules/entities/cli.ts:287-323`), reachable through `mercato entities seed-encryption --tenant … --org …` or an explicit upgrade action. Its own header comment states the constraint: maps are *"seeded once at tenant creation and never re-run"*.

The consequence is this spec's own failure class, one level up: an organization that already carries an `encryption_maps` row — the only kind that needs the blind index — keeps its stale `fields_json`, so no hash is ever written, the hash arm matches nothing, and no error is raised anywhere. **Reconciling the persisted map is therefore part of the change, not an operational afterthought**, and it is what Step 2 below adds. There is an exact precedent to copy: `devices.seed-push-token-encryption-map` in `packages/core/src/modules/configs/lib/upgrade-actions.ts:65-85` exists for the identical problem and documents the identical reasoning.

## 📝 Proposed Solution

Add `primary_email_hash` to `customer_entities` and `domain_hash` to `customer_companies`, declare them via `hashField`, and make the lookup helpers query them. Four properties shape the design:

**The hash is a candidate filter, not the verdict.** `encryptFields` skips `null`/`undefined` values, so clearing `domain` to `NULL` leaves the previous `domain_hash` **stale** on the row. A reader that trusted hash equality alone would return a company whose domain was cleared. Every helper therefore confirms the match against the decrypted value it already loads — which also neutralises hash collisions and any future write-path drift. This costs nothing: the helpers already decrypt through `findWithDecryption`.

**Plaintext equality is a correctness arm, not a fallback.** When an organization runs with encryption off the hash column is `NULL`, but the plaintext column holds the raw value, so `WHERE primary_email IN (…)` is exact. Both arms are needed to cover all four states — encrypted+hashed, plaintext+unhashed, and the two mixed states an organization passes through when encryption is switched on.

**The arms run as separate queries, not as one `$or`.** This is the one place where the obvious shape and the correct shape differ, so it is worth stating why. A single disjunction would emit

```sql
WHERE tenant_id = $1 AND organization_id = $2 AND kind = 'person' AND deleted_at IS NULL
  AND (primary_email_hash = ANY($3) OR primary_email = ANY($4))
```

and Postgres can only serve a disjunction from indexes when **every** branch is independently indexable — that is what lets it build a `BitmapOr`. `primary_email` carries no index of its own and deliberately gains none here, so the second branch is not indexable, the `BitmapOr` is unavailable, and the planner falls back to the access path implied by the `AND`-ed predicates (`customer_entities_org_tenant_kind_idx` on `(organization_id, tenant_id, kind)`, `data/entities.ts:9`), evaluating the whole `OR` as a post-scan filter. The new `customer_entities_primary_email_hash_idx` would never be consulted by the one query it exists to serve.

Running the arms sequentially — the hash query first, then the plaintext query only for inputs the hash query left unresolved — restores the index. The hash query is a clean index-backed lookup on `(tenant_id, organization_id, primary_email_hash)`; the plaintext query runs only when something is still outstanding, which on an encrypted-and-backfilled organization is never, and on a plaintext organization is the same tenant/organization/kind-bounded filter as today's fast path. It is the same "arm N for anything still unresolved" shape the retained bounded scan already uses. One round trip in the common case, two in the mixed case, and every correctness property above preserved.

**The bounded scan is retained as defence-in-depth, not deleted.** Rows written *before* this ships in an *already-encrypted* organization have ciphertext and a `NULL` hash until the backfill runs. Keeping the existing 500-row scan as a last arm means the change can never regress a lookup that works today, and the deployment does not have to be ordered against the backfill. The issue's acceptance criteria explicitly permit this ("bounded scan removed **or kept only as defense-in-depth**").

### Alternatives considered

| Alternative | Why it lost |
|---|---|
| Write the hash unconditionally in the customers write paths, the way `auth` does with `computeEmailHash`, then read hash-only | `auth` touches one email field in a handful of command handlers; `CustomerEntity.primaryEmail` and `CustomerCompanyProfile.domain` are written from `commands/people.ts`, `commands/companies.ts` (create, update, merge, undo, restore), CLI seeds, and import paths. Every missed site silently produces a `NULL` hash — reintroducing the exact silent-zero-row failure class this spec removes. The multi-arm reader is correct without touching a single write path. |
| Make encryption deterministic (SIV / fixed IV) for these columns | Hand-rolled deviation from the project's AES-GCM contract, weakens the at-rest guarantee for every consumer of the column, and breaks existing ciphertext. |
| Fix the `$ilike` substring search in the list routes at the same time | A hash column cannot serve substring search; that needs the search-index path and is a different design. Deferred — see Out of scope. |

### Out of scope

- **`primary_phone`** — the same defect on the phone axis, tracked in [#5515](https://github.com/open-mercato/open-mercato/issues/5515). Deliberately excluded so this change stays one reviewable unit. Once this lands, #5515 is the same three edits on one more column; if both are scheduled together the implementer should fold `primary_phone_hash` into this migration rather than adding a second one to `customer_entities`.
- **`$ilike` substring search over sealed columns** — `customers/api/people/route.ts:182,195,197` and `customers/api/companies/route.ts:188,283,285` build `$ilike` terms over `primary_email`. These are **already mitigated** and are not part of this defect: both routes go through `makeCrudRoute` and therefore the query engine, and `BasicQueryEngine.applyFilterOp` (`packages/shared/src/lib/query/engine.ts:575-616`) intercepts `like`/`ilike` on base columns while `searchActive` and reroutes them through `search_tokens` instead of emitting SQL `ILIKE`. In the default configuration the rewrite covers every searched column, because `OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS` defaults to `false` (`packages/shared/src/lib/search/config.ts:124`) and `encryptedLikeFields` stays `null`. Substring search degrades to a genuine ciphertext `ILIKE` only when search is disabled, the entity has no `search_tokens` rows, or the term yields no indexable tokens — and each of those emits a `warnOnCiphertextLikeFallback` warning (`packages/shared/src/lib/query/ciphertext-search-warning.ts:25-33`). Out of scope because a hash column cannot serve substring search at all, not because the path is unhandled.
- **The `?email=` exact filter on the list routes** — `filters.primary_email = { $eq: email }` (`people/route.ts:193`, `companies/route.ts:283`) genuinely is broken on an encrypted organization: the token rewrite above covers only `like`/`ilike`, so `$eq` compares against ciphertext. It is deferred for review-surface reasons, not for cost: once Phase 1 lands the column, `filters.primary_email_hash = { $eq: hash }` is filterable immediately, because `resolveBaseColumn` (`engine.ts:1609-1613`) resolves a filter field against `information_schema.columns` and only falls back to the `entity_indexes.doc` EXISTS sub-filter when the table has no such column (`engine.ts:786-788`). No indexed-field-set edit and no reindex are involved. What the follow-up does own is the API-surface decision — whether `?email=` silently changes meaning for callers who currently rely on its plaintext behavior, and how it interacts with `hasEmail`/`emailStartsWith`/`emailContains` in the same routes. Recorded as the natural first follow-up on that basis.

## 📝 Architecture

Nothing new is invented. The change is five edits against existing seams:

| Seam | Change |
|---|---|
| `customers/encryption.ts` | Add `hashField` to the two field rules, plus a doc comment at each map entry pointing at the matcher helper — the reporter states this comment alone would have prevented their bug, and it is where a caller actually looks. |
| `customers/data/entities.ts` | Two nullable `text` columns with a plain index each. |
| `customers/migrations/` | One additive migration; columns and indexes only, no data rewrite. |
| `configs/lib/upgrade-actions.ts` | One new upgrade action re-seeding the two customers `encryption_maps` rows for pre-existing tenants, so the `hashField` declaration reaches the runtime. |
| `customers/lib/` | `findPeopleByAddresses` gains the hash arm; `findCompaniesByDomains` is added beside it with the same shape. |

No **write path** is edited: `TenantEncryptionSubscriber` already calls `encryptFields`, which populates `rule.hashField` whenever it encrypts. That mechanism only engages once the persisted `encryption_maps` row carries the declaration, which is what the upgrade-action seam above delivers — see [Why the declaration alone is not enough](#why-the-declaration-alone-is-not-enough).

Two consequences of the write path worth stating, because both are invisible at a reader's call site:

- `encryptFields` short-circuits on `if (isEncryptedWithDek(value, dek)) continue` (`tenantDataEncryptionService.ts:413`) **before** the `rule.hashField` branch. A write whose payload already holds ciphertext — an update on a row loaded without decryption — leaves the hash untouched. Pre-existing encrypted rows therefore do not self-heal through ordinary traffic; only the Phase 3 backfill fills them.
- `encryptFields` skips `null`/`undefined` values entirely, so clearing a value leaves the previous hash behind. That is why the reader verifies every candidate against the decrypted value.

### Reader shape

Both helpers share one shape, expressed here for the person matcher:

```
1. candidates = lookupHashCandidates(value) for each normalized input   // spans v2: and legacy digests
2. hash query:      { primaryEmailHash: { $in: allCandidates } }        // index-backed
   verify:          compare each row's DECRYPTED primaryEmail; drop non-matches
3. if any input is still unresolved →
   plaintext query: { primaryEmail: { $in: stillUnresolvedValues } }
   verify:          the same way
4. if any input is STILL unresolved → the existing bounded newest-first scan, verified the same way
   → and, when the organization has an encryption_maps row, warn (see Observability below)

   on every arm, "verify" has THREE outcomes, not two:
     verified match | verified non-match (drop) | could not decrypt (drop, but COUNT AND WARN)
   — see "The verify step needs a third outcome" below
```

Verification after every arm is what makes the cheap predicates safe. Arms 2 and 3 are ordered so the indexed one runs first and the unindexed one is skipped entirely whenever the index already answered — see "The arms run as separate queries" above for why a single `$or` cannot do this. Arm 4 is unchanged from today and disappears on its own once an installation has reconciled its maps and run the backfill — it simply stops finding anything the earlier arms missed. (These four numbers describe the reader's internal shape; they are unrelated to the numbered Implementation Plan steps below.)

### Observability — the inert state must not be silent

The design's own worst case is that it ships switched off: a map that was never reconciled, or a backfill that never ran, leaves arms 2 and 3 contributing nothing while arm 4 quietly resolves everything within its 500-row bound. Lookups appear to work, and for a person older than `MATCH_CANDIDATE_LIMIT` they still silently return nothing — the exact bug this spec exists to remove, still present, still indistinguishable from "no such person".

The retained scan is therefore both the safety net and the thing that hides the failure, so it must announce itself. Two rate-limited warnings through the structured logging facade (`createLogger`), following the precedent of `warnOnCiphertextLikeFallback` (`packages/shared/src/lib/query/ciphertext-search-warning.ts`) and `warnOnEncryptedLikeFilter` (`packages/shared/src/lib/encryption/find.ts:29`), which exist for exactly this class of silent encryption-related degradation:

- **Arm 4 resolved something the earlier arms missed, on an organization that has an `encryption_maps` row** — the blind index is not carrying its traffic. Name the (tenant, organization) scope and point at `mercato customers lookup-hashes:backfill`.
- **Arm 4 exhausted `MATCH_CANDIDATE_LIMIT` with inputs still unresolved** — the answer may be a false negative rather than a genuine "no such person". This is the one case where the caller is being misled, and today it is completely silent.

Neither fires for an organization with no `encryption_maps` row: there the plaintext arm is exact and arm 4 is not expected to contribute.

### Hash computation must stay context-free

`encryptFields` calls `hashForLookup(serialized)` with **no `context` argument** (`tenantDataEncryptionService.ts:419`), while `hashForLookup(value, context?)` accepts one and produces a different digest when given it (`aes.ts:141`; the existing `lookupHash.test.ts` case *"binds the digest to the optional field/entity context"* already asserts that divergence). A reader that passes a context would compute a digest that can never match a stored one — another silent zero-row failure, and one that is invisible at the reader's call site.

The divergence only manifests when a lookup pepper is configured: with no pepper, `hashForLookup` falls back to `legacyHashForLookup(value)`, which ignores `context` entirely, so the context and no-context digests agree. Any test pinning the asymmetry must therefore set a pepper explicitly — otherwise it passes vacuously and pins nothing. Every existing consumer (`auth/lib/emailHash.ts`, `customer_accounts/services/customerUserService.ts`, `messages/api/route.ts`) omits the context, and this spec pins that asymmetry with a test rather than leaving it to convention.

Normalization is handled inside the hash helpers — `normalizeLookupValue` lowercases and trims on both the `v2:` and legacy paths — so case-insensitive matching is inherited, not re-implemented.

### Digest scoping — the index is salted per installation, not per tenant

The columns this spec adds are scoped by `tenant_id` and `organization_id` in every predicate and both indexes. **The digest values themselves are not scoped at all**, and the two statements are easy to conflate, so this section states the second one plainly.

`resolveLookupPepper()` (`packages/shared/src/lib/encryption/aes.ts:117-129`) reads three process-wide environment variables — one pepper per installation, not per tenant — and, per the section above, the write side calls `hashForLookup(serialized)` with no `context`. Therefore the same email or domain produces a **byte-identical digest in every tenant and every organization of the installation**, and in every no-context `*_hash` column in it: `auth:user.email_hash`, `customer_accounts:customer_user.email_hash`, `messages:message.external_email_hash`, `onboarding:onboarding_request.email_hash`, and the two added here.

This is a **new** correlation channel, not a restatement of an existing one. The ciphertext in these columns today is not cross-tenant correlatable: tenant DEKs are derived per tenant (`DerivedKmsService.deriveKey` is `pbkdf2(root, tenantId, 310_000)`, `packages/shared/src/lib/encryption/kms.ts:154-159`; the Vault path is per-tenant as well) and every write uses a fresh random IV, so two tenants holding the same person produce unrelated ciphertext. After this change they produce equal digests, in an indexed column. Anyone reading the database — a replica, a backup, an analytics mirror, an operator scoped to a single tenant — can then answer *"is this person also in tenant B?"* or *"is this CRM contact also a portal user?"* with a join and no secret, because equality needs no pepper.

**The trade-off is accepted deliberately, and binding the digest to the tenant is rejected**: `encryptFields` has no tenant in scope where it hashes (`tenantDataEncryptionService.ts:419`) and passes no `context`, so a tenant-salted digest would mean deviating from the framework write-path contract that the rest of this spec depends on not deviating from — and would diverge from the four `hashField` columns already shipped. The residual risk is recorded here so that approving this spec is a knowing acceptance of it, and it is the natural place to revisit if the framework ever gains a tenant-scoped lookup pepper.

### Configuration precondition — the keyed digest is not automatic

The security argument for a blind index rests on the keyed `v2:` HMAC. That mitigation is **conditional on a pepper resolving**, and the configuration in which it does not is reachable:

- `createKmsService()` (`kms.ts:426-452`) returns a healthy HashiCorp Vault primary on `VAULT_ADDR` + `VAULT_TOKEN` alone; `resolveDerivedKeySecret()` is consulted only to build the *fallback*.
- `resolveLookupPepper()` (`aes.ts:117-129`) reads a **disjoint** set: `LOOKUP_HASH_PEPPER`, `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`, `TENANT_DATA_ENCRYPTION_KEY`.

A Vault-backed installation that sets none of those three therefore runs with **tenant data encryption fully on and no pepper**, and `hashForLookup` falls back to `legacyHashForLookup(value)` — an unkeyed SHA-256 of the normalized value (`aes.ts:100-102`).

For the domain axis that is not a blind index but a reversible copy of the sealed column: registered domains are a public, enumerable namespace of a few hundred million entries, so an offline dictionary over SHA-256 recovers `domain` for every tenant at once. The four existing `hashField` users are all email columns; `domain_hash` is the first **low-entropy, publicly enumerable** blind index in the codebase, which is why the precondition is stated here rather than left to the framework.

Consequences for the plan, so this cannot ship silently mis-configured:

- **Step 9 (backfill)** treats an unresolvable pepper on an encrypting scope as an error: warn and exit non-zero without writing, rather than filling a new indexed column with unkeyed digests.
- **Step 2 (upgrade action)** warns in the same situation — the declaration it seeds is what starts the write path hashing.
- **Step 10 (operations doc)** names `LOOKUP_HASH_PEPPER` as the recommended configuration for any installation enabling this, and states what is lost without it.

### The verify step needs a third outcome: "could not decrypt"

Verification against the decrypted value is what makes the cheap predicates safe, but as described it has only two outcomes — **verified match** and **dropped** — and a candidate row that *did not decrypt* falls into the second. That silently reclassifies a decryption failure as "no such person", which is the exact failure class this spec exists to remove, one layer up.

The failure is reachable rather than theoretical, and [#5822](https://github.com/open-mercato/open-mercato/pull/5822) — open against `develop` while this spec is in review — widens it on precisely this path. It binds decryption to the tenant the *caller* asserted instead of the tenant stored on the row, and it guards `EncryptionSubscriber.decrypt`, reached through `decryptEntitiesWithFallbackScope` (`packages/shared/src/lib/encryption/subscriber.ts:453-488`) — the function `findWithDecryption` calls (`packages/shared/src/lib/encryption/find.ts:38-43`). A refused row is **left as ciphertext, does not throw, and contributes to one aggregated warning per entity**. Fail-closed and silent is correct for #5822; combined with an unconditional verify step it produces a false negative indistinguishable from a genuine miss.

Three requirements follow, and they apply to both helpers:

1. **Distinguish "could not verify" from "verified non-match".** A candidate row whose value does not decrypt — refused scope, missing DEK, decrypt error — is never emitted as a match, but is counted and reported through the same rate-limited facade as the Observability warnings above, naming the (tenant, organization) scope. A caller must never be told "no such person" because a DEK was unavailable.
2. **Pass the decryption scope explicitly.** Every `findWithDecryption` call passes `{ tenantId, organizationId }`, as `findPeopleByAddresses.ts:65` already does today. This is now load-bearing rather than incidental: an implicit row-derived scope is exactly what #5822 removes, and the queries already filter `tenant_id`, so a correctly scoped read is never refused.
3. **Never run these helpers on a path that declined decryption.** #5822 adds a `decryptEncryptedFields` opt-out; a declined query returns ciphertext for every row, so every arm's verify step would drop every candidate and the helper would return an empty result with no error. The helpers own their reads and must not be handed a pre-fetched, undecrypted row set.

**Sequencing.** This is a compatibility note, not a hard dependency: the requirements above are correct whether or not #5822 lands first. If it lands first, requirement 2 is what keeps these helpers on the allowed side of the new binding; if this lands first, requirement 1 is what stops #5822 from turning a refusal into a silent CRM miss.

## 📝 Data Model

Two nullable columns, both additive per `BACKWARD_COMPATIBILITY.md` §8:

| Table | Column | Type | Index |
|---|---|---|---|
| `customer_entities` | `primary_email_hash` | `text NULL` | `customer_entities_primary_email_hash_idx` on `(tenant_id, organization_id, primary_email_hash)` |
| `customer_companies` | `domain_hash` | `text NULL` | `customer_companies_domain_hash_idx` on `(tenant_id, organization_id, domain_hash)` |

Entity properties follow the `customer_users.emailHash` precedent, but **nullable** — unlike `customer_users`, these columns are populated only when the organization encrypts, and both source columns are themselves nullable:

```ts
@Property({ name: 'primary_email_hash', type: 'text', nullable: true })
primaryEmailHash?: string | null
```

**No unique constraint.** `customer_users_tenant_email_hash_uniq` is right for an account table; CRM data is not. Two people legitimately share a shared-inbox address, and many companies share a domain (subsidiaries, or the same company entered per-region). A unique index would also fail the migration outright on existing duplicate data.

This spec adds the hash columns to no API response shape, no `list.fields` selection, and no index document, and nothing in the customers surfaces exposes them: `list.fields` is a server-side declaration rather than a caller-supplied parameter (`packages/shared/src/lib/crud/factory.ts:212`), and the people/companies filters are built server-side from a zod-validated query schema. Read that as a statement about what this change adds, not as a property of the column — as [Out of scope](#out-of-scope) notes, `resolveBaseColumn` resolves *any* real base column, which is precisely what makes the deferred `?email=` follow-up cheap. A future surface that wants to expose or filter these columns must decide that deliberately.

Declaring `hashField` also feeds the search package's field policy (`packages/search/src/di.ts:77-80`, `packages/search/src/lib/field-policy.ts:87-91,129-133`), where a field carrying a `hashField` is classified hash-searchable rather than excluded. Verified inert **in-repo**: the only in-repo production consumer of that module is `extractSearchableFields` in the Meilisearch driver (`packages/search/src/fulltext/drivers/meilisearch/index.ts:151`), which skips any field present in the encryption map regardless of `hashField`; `extractHashOnlyFields` and `classifyFields` have no in-repo caller outside tests. They are, however, re-exported from `packages/search/src/lib/index.ts:8-10` — the package's public barrel — so they are part of `@open-mercato/search`'s published surface, and a third-party consumer calling either against `customers:customer_entity` or `customers:customer_company_profile` will see the classification change even though no in-repo caller does. Additive under `BACKWARD_COMPATIBILITY.md` §2/§3 (no signature or type changes), and no reindex and no search-config edit follow from this spec.

### Soft-delete scoping on the company axis

`CustomerEntity` is soft-deleted and `findPeopleByAddresses` filters `deletedAt: null` on both of its arms (`findPeopleByAddresses.ts:74,86`). `CustomerCompanyProfile` has **no** `deleted_at` column of its own (`data/entities.ts:247-300`) — deletion lives on the owning `customer_entities` row, reached through the `@OneToOne` at `entities.ts:294-298`. `findCompaniesByDomains` must therefore constrain the owning entity on **both** axes, `kind: 'company'` and `deletedAt: null`; constraining only `kind` would let a dedup probe link a live prospect to a company somebody deleted, which is worse than today's behavior of having no helper at all.

This also bounds what the new index can do. Unlike the person axis — where `idx_ce_tenant_org_company_id` and its siblings are partial indexes carrying `where deleted_at is null and kind = …` — `customer_companies_domain_hash_idx` cannot express either predicate, because both columns live on the other table. The hash arm narrows to a small candidate set and the join applies the guards; that is acceptable because the candidate set is keyed by a full-value digest, not by a prefix.

### Backfill

Rows that predate this change have a `NULL` hash. The backfill **cannot be SQL** — the keyed `v2:` digest needs the pepper from the environment (`LOOKUP_HASH_PEPPER` / `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` / `TENANT_DATA_ENCRYPTION_KEY`), and already-encrypted rows must be decrypted before they can be hashed. It ships as an idempotent CLI command following the module's existing `interactions:backfill` convention and the `auth rotate-encryption-key` precedent, which does exactly this work for `auth:user`:

- `mercato customers lookup-hashes:backfill [--tenant-id …] [--organization-id …] [--dry-run]`
- Processes per (tenant, organization) scope, reading through `findWithDecryption` so encrypted and plaintext rows are handled uniformly.
- Only fills rows where the hash is `NULL` and the source value is non-null; re-running is a no-op.
- Batched with an explicit page size so a large tenant does not load into one unit of work.

**Order matters.** The map reconciliation (Step 2) must land before the backfill runs: it is what makes subsequent writes carry the hash forward. A backfill run against a scope whose `encryption_maps` row still lacks `hashField` fills the column once and then watches it go stale on the next write to each row, because `encryptFields` never re-derives it.

Until an operator runs the backfill, the retained bounded scan covers pre-existing rows, so the backfill is a completeness-and-performance step rather than a correctness prerequisite for the newest 500 rows per organization. It is a correctness prerequisite for anything older, and because of the `isEncryptedWithDek` short-circuit noted in Architecture, those rows never fill themselves in.

## 📝 API Contracts

No HTTP route, request shape, or response shape changes. Two module-level exports are added or changed:

```ts
// packages/core/src/modules/customers/lib/findPeopleByAddresses.ts — unchanged signature
export async function findPeopleByAddresses(
  em, addresses: string[], tenantId: string, organizationId?: string | null,
): Promise<MatchedPerson[]>

// packages/core/src/modules/customers/lib/findCompaniesByDomains.ts — new
export function normalizeDomains(input: unknown): string[]
export interface MatchedCompany { id: string; domain: string }   // id = customer_entities.id
export async function findCompaniesByDomains(
  em, domains: string[], tenantId: string, organizationId?: string | null,
): Promise<MatchedCompany[]>
```

`normalizeDomains` needs its contract defined as precisely as `normalizeAddresses` defines its own (`findPeopleByAddresses.ts:11-24`), because the motivating caller derives domains from prospect email addresses and will pass shapes the naive rule does not cover. The specified behavior: trim and lowercase; strip a single leading `@` (so `@acme.com` from an email split is accepted); strip a leading `www.`; reject empty values, values containing whitespace, and values containing `/` or `:` (a URL is not a domain — the caller extracts it); require at least one interior dot; dedupe, preserving input order. Anything rejected is dropped silently, matching `normalizeAddresses`.

`MATCH_CANDIDATE_LIMIT` stays exported — `api/people/check-phone/route.ts:11` imports it, and removing it would be a breaking change to a public surface for no gain.

`findCompaniesByDomains` ships with **no in-core caller**. This is a deliberate, argued exception to the repo's "integrate through real call sites" rule: the helper is the requested deliverable — a platform primitive for module developers who today must write the broken predicate themselves — and its first in-core caller is the deferred `?domain=` list filter. It is exercised by unit tests against both the encrypted and plaintext paths. A maintainer who prefers no uncalled export should drop it from scope and reopen it with the list-route follow-up; the person-axis work stands alone.

`MatchedCompany.id` is the `customer_entities.id` (the anchor other CRM tables link to), not the `customer_companies.id`, matching `MatchedPerson.id` and what every caller actually needs.

## 📝 UI/UX

**One operator-facing surface: the Step 2 upgrade action.** No route, screen, or response field is added or modified, and nothing changes for an end user — but a configs upgrade action is not invisible. It ships `messageKey` / `ctaKey` / `successKey` / `loadingKey` (`packages/core/src/modules/configs/lib/upgrade-actions.ts:65-85`), is listed by `GET /api/configs/upgrade-actions`, and renders as a button an operator with `configs.manage` reads and clicks to reconcile the two encryption maps. Its copy is therefore user-visible and needs the locale entries listed in Step 2, and it needs the integration coverage listed in Step 2b — the CTA is the surface through which the whole design is actually switched on.

Otherwise the only visible effect is that lookups which silently returned nothing on encrypted organizations now return the right row.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| Organization has no `encryption_maps` row | Hash stays `NULL`; the plaintext arm matches exactly. Identical to today's fast path. |
| Organization encrypts; its `encryption_maps` row still predates this change (upgrade action not yet run) | `fields_json` carries no `hashField`, so **no hash is written at all** and both cheap arms miss on every row. The retained bounded scan is the only working arm. This is the state every existing encrypting organization starts in, which is why Step 2 exists. |
| Organization encrypts; map reconciled; row written after this ships | Hash written by `encryptFields`; hash arm matches. |
| Organization encrypts; map reconciled; row updated but loaded without decryption | `isEncryptedWithDek` short-circuits before the hash branch, so an existing `NULL` hash stays `NULL` and an existing hash is left as-is. Covered by the scan until the backfill runs. |
| Organization encrypts; row written *before* this ships, backfill not yet run | Both cheap arms miss; the retained bounded scan resolves it exactly as today. No regression. |
| Company whose owning `customer_entities` row is soft-deleted | The owning-entity guard (`kind: 'company'`, `deletedAt: null`) excludes it on every arm, so `findCompaniesByDomains` never returns a tombstoned company. |
| Row written while encryption was off, organization later encrypts | Row stays plaintext with `NULL` hash until it is next written; the plaintext arm matches throughout. |
| `domain` (or `primary_email`) cleared to `NULL` | `encryptFields` skips null values, so the stale hash survives on the row. The verify-against-decrypted-value step drops the row, so the helper does not return it. |
| Two rows share an email / domain | Both are returned as candidates; the helper emits one match per input value, first verified row wins — the existing `findPeopleByAddresses` contract, unchanged. |
| Pepper is rotated or newly configured | `lookupHashCandidates` returns both the `v2:` and legacy digests, so reads keep matching pre-rotation rows; re-running the backfill recomputes them. |
| Hash collision, or a hash written by a future drifting write path | The verify step compares the decrypted value, so a false candidate is never emitted as a match. |
| **Candidate row does not decrypt** (missing DEK, decrypt error, or a scope refused by [#5822](https://github.com/open-mercato/open-mercato/pull/5822)'s caller-tenant binding) | Never emitted as a match — but counted and warned, not silently dropped. Without this the helper reports "no such person" for a row it actually found, which is the failure class this spec removes. See [The verify step needs a third outcome](#the-verify-step-needs-a-third-outcome-could-not-decrypt). |
| Helper invoked on a read that declined decryption (#5822's `decryptEncryptedFields` opt-out) | Every candidate arrives as ciphertext, so every arm drops everything and the result is an empty set with no error. The helpers therefore own their own reads and are never handed a pre-fetched, undecrypted row set. |
| Encryption on, but no lookup pepper resolves | Every digest written is an unkeyed SHA-256. Steps 2 and 9 warn (the backfill exits non-zero) rather than filling the new indexed column silently — see [Configuration precondition](#configuration-precondition--the-keyed-digest-is-not-automatic). |
| Backfill interrupted midway | Idempotent and `NULL`-guarded; re-run resumes. Partially backfilled data is still correct because of the retained scan. |
| Backfill hits an undecryptable row (missing DEK) | Skip, count, and report it; never write a hash derived from ciphertext, which would poison the index with a value no reader can ever produce. |

## 📝 Risks & Impact Review

| Risk | Assessment |
|---|---|
| **Blast radius** | Two nullable columns and two indexes on core tables, one encryption-map edit, one configs upgrade action, one changed helper, one new helper, one new CLI command. No write path, API contract, or UI touched. |
| **Silent-inertness** | The failure mode this design is most exposed to is its own: a `hashField` declaration that never reaches the persisted `encryption_maps` row leaves the feature switched off with no error anywhere. Mitigated by Step 2's upgrade action, by Step 2's test asserting the persisted-row path rather than the module literal, and by the retained scan, which keeps lookups correct (if slow) throughout. The scan is also what *hides* the inert state, so it is instrumented rather than left silent — see Observability in Proposed Solution, which makes both "the blind index is carrying no traffic" and "this answer may be a false negative" visible in the logs. |
| **Backward compatibility** | Additive only per `BACKWARD_COMPATIBILITY.md` §8 (DB schema) — new nullable columns, no removals, no narrowing. `data/entities.ts` gains properties; no export is removed or renamed. `MATCH_CANDIDATE_LIMIT` is retained for its existing importer. |
| **Index creation lock** | MikroORM runs migrations in a transaction, so `CREATE INDEX CONCURRENTLY` is not available. `customer_entities` and `customer_companies` are organization-scoped CRM tables, not append-only event tables, so a plain index build is a short lock. An operator with an unusually large tenant should build the indexes out-of-band before applying the migration. |
| **Security** | A blind index is a deliberate, documented trade-off already made four times in this codebase: it makes the sealed value equality-searchable to anyone with database access. The keyed `v2:` HMAC (`hashForLookup`) is the mitigation, and it is **conditional on a pepper resolving** — see [Configuration precondition](#configuration-precondition--the-keyed-digest-is-not-automatic), which is why Steps 2 and 9 refuse to write unkeyed digests silently. No new secret, no new hand-rolled crypto, no plaintext at rest. |
| **Tenant isolation — query scoping** | Both indexes and every helper predicate are scoped by `tenant_id` and `organization_id`; the helpers keep their existing early return when `organizationId` is absent. The upgrade action and the backfill iterate per (tenant, organization) scope. |
| **Tenant isolation — digest scoping** | ⚠️ **The digest carries no tenant binding, by design.** The pepper is installation-wide and the write side passes no `context`, so one value yields one digest across every tenant and all five `*_hash` columns — a correlation channel the per-tenant-DEK ciphertext does not have. Argued and deliberately accepted in [Digest scoping](#digest-scoping--the-index-is-salted-per-installation-not-per-tenant); approving this spec means accepting it. |
| **Decryption-boundary coupling** | The verify step depends on candidates arriving decrypted, and [#5822](https://github.com/open-mercato/open-mercato/pull/5822) makes a refused decryption silent on this exact path. Mitigated by the three requirements in [The verify step needs a third outcome](#the-verify-step-needs-a-third-outcome-could-not-decrypt); correct in either merge order. |
| **Rollback** | Each phase is independently revertible. Reverting the reader restores today's behavior exactly (the scan never left). Reverting the migration drops two unread nullable columns — no data loss, because the hash is derived, never authoritative. |
| **Performance** | Better on the case that matters and never worse: for a reconciled-and-backfilled encrypted organization the common path is a single index-backed hash lookup, and neither the plaintext query nor the 500-row decrypting scan is issued at all. This depends on the arms running as **separate sequential queries** — a single `$or` would leave the new index unused, because Postgres cannot build a `BitmapOr` when one branch (`primary_email`, deliberately unindexed) has no index; see Proposed Solution. For a plaintext organization the hash query matches nothing and the plaintext query runs the same tenant/organization/kind-bounded filter as today, so the plan is unchanged apart from one cheap extra round trip. |

## 📋 Phasing

Each phase leaves the application working and ships independently.

- **Phase 1 — The blind index.** Columns, `hashField` declarations, the map-reconciliation upgrade action and its integration coverage, migration, and the write-side tests. Nothing reads the columns yet; behavior is unchanged.
- **Phase 2 — Route the readers.** `findPeopleByAddresses` gains the hash arm; `findCompaniesByDomains` is added; doc comments land at the encryption-map seam.
- **Phase 3 — Backfill.** The CLI command that fills hashes for pre-existing rows.

## 📋 Implementation Plan

### Phase 1 — The blind index

**Step 1.** Add `hashField` to the two rules in `packages/core/src/modules/customers/encryption.ts` (`primary_email` → `primary_email_hash`, `domain` → `domain_hash`), with a doc comment on each map entry stating that the column is not queryable by value, naming the helper to use instead (`findPeopleByAddresses`, `findCompaniesByDomains`), and noting that the declaration only takes effect once the tenant's `encryption_maps` row has been reconciled.
*Test:* a unit test asserting the two rules carry the expected `hashField` is **not sufficient on its own** — the array is a literal in this same commit, so such an assertion is true by construction and stays true on an installation where no hash is ever written (the equivalent test at `packages/onboarding/src/__tests__/encryption.test.ts:10` has exactly this shape). Pin it if you like as a cheap regression guard, but the meaningful coverage is Step 2's.

**Step 2.** Reconcile the persisted maps. Register a configs upgrade action — `customers.seed-email-domain-hash-encryption-map`, following `devices.seed-push-token-encryption-map` (`packages/core/src/modules/configs/lib/upgrade-actions.ts:65-85`) — that lazy-imports `@open-mercato/core/modules/customers/encryption` and `upsertEncryptionMapSpecs` from `@open-mercato/core/modules/entities/cli` and re-seeds the two affected customers maps for the (tenant, organization) scope.

**Pass a filtered array, not the module's whole export.** The devices precedent hands `upsertEncryptionMapSpecs` the entire `defaultEncryptionMaps` array, which is safe there only because `devices/encryption.ts` declares exactly one entity map. `customers/encryption.ts` declares **eight** (`customer_address`, `customer_entity`, `customer_deal`, `customer_activity`, `customer_interaction`, `customer_comment`, `customer_person_profile`, `customer_company_profile`), and `upsertEncryptionMapSpecs` overwrites an existing row unconditionally — `existing.fieldsJson = spec.fields` (`entities/cli.ts:287-323`). Encryption maps are also operator-editable at runtime: `packages/core/src/modules/entities/api/encryption.ts:71` exposes a `POST` guarded by `entities.definitions.manage` that writes `fieldsJson` directly. Passing all eight would therefore silently revert any operator customization on any customers map — with no diff, no warning, and no record — for a change whose whole premise is that silent encryption-map drift is dangerous. Scope the action to what it needs:

```ts
const specs = customersEncryptionMaps.filter(
  (map) => map.entityId === 'customers:customer_entity'
        || map.entityId === 'customers:customer_company_profile',
)
await upsertEncryptionMapSpecs(em, tenantId, organizationId ?? null, specs)
```

Follow the precedent's other conventions: `messageKey` / `ctaKey` / `successKey` / `loadingKey` locale entries, a `version` matching the release this ships in, and a comment stating why the action exists. Put the locale keys under `customers.config.upgradeActions.emailDomainHashEncryptionMap.*` in `packages/core/src/modules/customers/i18n/`, following the sibling customers-owned action `customers.seed-interaction-statuses` (`upgrade-actions.ts:87`) rather than the devices action's `configs.upgrades.*` namespace — a customers-owned action keeps its strings with its module. They must land in every locale file the module ships (`en`, `de`, `pl` at minimum), because `yarn i18n:check-sync` is in the validation gate. Seeding is safe when encryption is off, because the map is only a declaration of which fields to encrypt.
The action also warns when tenant data encryption is on for the scope but `resolveLookupPepper()` returns nothing — the declaration it seeds is what starts the write path hashing, and hashing without a pepper writes unkeyed digests (see [Configuration precondition](#configuration-precondition--the-keyed-digest-is-not-automatic)).
*Test:* the load-bearing test of this spec. Assert that (a) an existing `encryption_maps` row whose `fields_json` predates this change is rewritten by the action to carry both `hashField` entries, (b) it is idempotent on a second run, (c) `encryptEntityPayload` driven by the **persisted** map — not by the module literal — populates the hash column beside the ciphertext, and (d) the other six customers maps are left untouched, which is what the filtered spec array above buys. Without (c) the whole design can ship inert and every test still passes.

**Step 2b.** Integration coverage for the upgrade action, which is the surface an operator actually uses to switch this on and the only user-facing surface this spec adds (see UI/UX). Extend the existing upgrade-actions family — `packages/core/src/modules/configs/__integration__/TC-CONF-006.spec.ts` covers `GET /api/configs/upgrade-actions` — with a case asserting that the new action is listed for a tenant that needs it, that running it reconciles both customers maps for the scope, and that a second run is a no-op. Self-contained per `.ai/qa/AGENTS.md`: create the pre-change `encryption_maps` fixture in setup and clean it up in teardown, without relying on seeded data.

**Step 3.** Add `primaryEmailHash` to `CustomerEntity` and `domainHash` to `CustomerCompanyProfile` in `data/entities.ts` — nullable `text`, with the composite indexes from the Data Model section.
*Test:* covered by Step 4's migration test and the typecheck gate.

**Step 4.** Generate the additive migration with `yarn db:generate`, keeping only the two columns and two indexes, and update `migrations/.snapshot-open-mercato.json`. Per `AGENTS.md`, delete any unrelated generated output rather than applying migrations locally.
*Test:* migration test asserting both columns and both indexes exist after up, and are gone after down.

**Step 5.** Pin the write-side contract: a unit test over `TenantDataEncryptionService.encryptEntityPayload` for `customers:customer_entity` and `customers:customer_company_profile` asserting (a) the hash column is populated beside the ciphertext, (b) the stored value equals `hashForLookup(plaintext)` computed **without** a `context` argument, and (c) it does **not** equal `hashForLookup(plaintext, 'customers:customer_entity:primary_email')` — the asymmetry from `aes.ts:141` that would otherwise be discovered as a silent zero-row failure. The test **must set a lookup pepper** (`LOOKUP_HASH_PEPPER`) in its setup and clear it in teardown, following the `clearLookupEnv` pattern in `lookupHash.test.ts`: with no pepper both digests fall back to `legacyHashForLookup`, assertion (c) holds vacuously, and the test pins nothing. Assert the same holds when the value needs normalizing (mixed case, surrounding whitespace).

### Phase 2 — Route the readers

**Step 6.** Rewrite the body of `findPeopleByAddresses` to the four-step reader shape: `lookupHashCandidates` per normalized address, the index-backed hash query, then the plaintext query for whatever it left unresolved, each verified against the decrypted `primaryEmail`, then the retained bounded scan plus its warnings for anything still unresolved. The arms are **separate queries, not one `$or`** — see "The arms run as separate queries" in Proposed Solution for why a disjunction would leave the new index unused. Signature, `MatchedPerson`, `normalizeAddresses`, and `MATCH_CANDIDATE_LIMIT` are unchanged; update the doc comment so it describes the hash arm instead of pointing at #5515 as future work.
Every arm passes the explicit `{ tenantId, organizationId }` decryption scope to `findWithDecryption`, as the helper already does today (`findPeopleByAddresses.ts:65`), and every arm's verify has the three outcomes from [The verify step needs a third outcome](#the-verify-step-needs-a-third-outcome-could-not-decrypt) — a candidate that fails to decrypt is dropped **and** counted and warned, never folded into "no match".
*Test:* unit tests for each row of the Edge Cases table that applies to the person axis — encrypted+hashed, plaintext+unhashed, encrypted+unhashed (scan arm), stale hash after clearing, duplicate emails, and mixed-case input. Two tests pin the arm ordering rather than assuming it: the plaintext query is **not** issued when the hash query resolved every input, and the bounded scan is **not** issued when the first two arms resolved every input. Two more pin the Observability warnings: one fires when the scan resolves an address the earlier arms missed on an organization holding an `encryption_maps` row, and one fires when the scan exhausts `MATCH_CANDIDATE_LIMIT` with inputs still unresolved. One more pins the third verify outcome: a candidate row the hash arm found but whose value does not decrypt is not returned as a match **and** raises the undecryptable-candidate warning, rather than being reported as a clean miss.

**Step 7.** Add `packages/core/src/modules/customers/lib/findCompaniesByDomains.ts` with `normalizeDomains` (the contract defined in API Contracts above), `MatchedCompany`, and `findCompaniesByDomains` — the same four-step shape with the same sequential hash-then-plaintext arm ordering, the same explicit `{ tenantId, organizationId }` decryption scope, the same three verify outcomes, and the same Observability warnings, querying `CustomerCompanyProfile.domainHash` / `domain` and returning the owning `customer_entities.id`. Scope every query by `tenantId`/`organizationId`, and constrain the owning entity on **both** `kind: 'company'` and `deletedAt: null` (traversed through the `@OneToOne` at `entities.ts:294-298`) — `customer_companies` has no `deleted_at` of its own, so omitting the second guard returns tombstoned companies.
*Test:* the mirror of Step 6's unit tests on the domain axis; a test asserting the returned id is the entity id and not the profile id; a test asserting a company whose owning entity is soft-deleted is never returned, on the hash arm and the plaintext arm alike; and a `normalizeDomains` test covering each accepted and rejected shape from its contract.

**Step 8.** Integration coverage for the inbound-matching path that consumes the matcher (`lib/link-channel-message-handler.ts` → `findPeopleByAddresses`), extending the existing `__integration__/TC-CRM-EMAIL-*` family: an organization whose `encryption_maps` row declares `hashField` (seed it through the same `upsertEncryptionMapSpecs` path Step 2 uses, so the test exercises the reconciled shape rather than a hand-built map), a person whose email was written under encryption, and an inbound message that must link to that person. The test must be self-contained per `.ai/qa/AGENTS.md` — create the encrypted-organization fixture in setup and clean up in teardown, without relying on seeded data. Assert the link resolves for a person old enough to fall outside `MATCH_CANDIDATE_LIMIT`, which is the case that fails today.

### Phase 3 — Backfill

**Step 9.** Add `lookup-hashes:backfill` to `packages/core/src/modules/customers/cli.ts` following the `interactions:backfill` command shape and the `auth rotate-encryption-key` scope-iteration precedent: optional `--tenant-id` / `--organization-id` / `--dry-run`, per-scope batched iteration, fills only `NULL` hashes over non-null source values, skips and reports undecryptable rows, and prints a per-scope count. The command computes and writes the hash **explicitly** rather than re-saving the entity and relying on the subscriber: a re-save would re-encrypt the value under a fresh IV for no benefit, and — for a row whose in-memory value is still ciphertext — the `isEncryptedWithDek` short-circuit would skip the hash write entirely.

Per-scope map handling is a **three-way** decision, not a two-way one. Most organizations have no `encryption_maps` row at all — 2 of 10 carried one on the reporting installation — so treating "no row" like "row without `hashField`" would make a full sweep exit non-zero on the majority of scopes and train operators to ignore the one exit code that carries the real warning:

| Scope state | Behavior |
|---|---|
| No `encryption_maps` row | Skip with an informational line; encryption is off, the plaintext arm is exact, and the hash is irrelevant. Contributes nothing to the exit status. |
| Row present, no `hashField` | Warn and exit non-zero — backfilling ahead of the Step 2 reconciliation produces values that go stale on the next write. |
| Row present with `hashField`, but no lookup pepper resolves | Warn and exit non-zero **without writing**. Filling a new indexed column with unkeyed SHA-256 digests is the one outcome nobody should get by default — see [Configuration precondition](#configuration-precondition--the-keyed-digest-is-not-automatic). |
| Row present with `hashField` | Backfill the scope. |

*Test:* unit test over the backfill routine asserting it fills a plaintext row and an encrypted row, leaves an already-hashed row untouched, is a no-op on the second run, skips an undecryptable row without writing, and returns each of the three per-scope map states above with the right exit contribution.

**Step 10.** Document the operational sequence: a short section in the customers module `AGENTS.md` (or the module's docs page, wherever the module documents CLI commands) stating that installations with tenant data encryption enabled must **first** apply the Step 2 upgrade action (or run `mercato entities seed-encryption` for each scope) and **then** run `mercato customers lookup-hashes:backfill`, that the order matters because the reconciled map is what keeps subsequent writes hashed, and that lookups degrade to the bounded 500-row scan until both have run. The same section names `LOOKUP_HASH_PEPPER` as the recommended configuration for any installation enabling this — an installation whose DEKs come from Vault has no pepper unless it sets one, and without it every digest is an unkeyed SHA-256 rather than a keyed HMAC — and states the digest-scoping property from [Digest scoping](#digest-scoping--the-index-is-salted-per-installation-not-per-tenant), so an operator reading the runbook learns it too.

### Validation

Run the repository's configured gate from `.ai/agentic.config.json` in order: `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.

## Resolved assumptions (autonomous defaults)

This spec was written by an unattended run; every Open Question was resolved with the most reversible, lowest-blast-radius answer. Each is listed with its rationale so a maintainer can override before merge.

| # | Question | Resolution | Rationale |
|---|---|---|---|
| Q1 | Who writes the hash — the encryption subscriber via `hashField`, or also the customers write paths unconditionally? | `hashField` only; no write path is touched. The declaration is paired with a map-reconciliation upgrade action (Step 2), without which it reaches no existing tenant. | The `auth` pattern of writing the hash explicitly means auditing every create/update/merge/undo/restore site in `commands/people.ts` and `commands/companies.ts` plus CLI seeds and import paths, where a single missed site silently reintroduces the bug. The multi-arm reader is correct without any of that. |
| Q2 | Reader shape — hash-only, or dual-arm? | Three arms: hash equality, plaintext equality, then the retained bounded scan; every arm verified against the decrypted value, and the arms issued as **sequential queries** so the later ones are skipped once the earlier ones resolve every input. | Hash-only regresses plaintext organizations and pre-backfill rows. The three-arm shape cannot regress any lookup that works today, which decouples the deployment from the backfill. Sequencing rather than a single `$or` is what keeps the hash arm index-backed — see Proposed Solution; the second review pass corrected this. |
| Q3 | Backfill in the migration, or a CLI command? | A separate idempotent CLI command, `customers lookup-hashes:backfill`. | The keyed digest needs the environment pepper and encrypted rows need decrypting, so raw SQL cannot compute either. Follows the module's `interactions:backfill` convention and the `auth rotate-encryption-key` precedent. |
| Q4 | Unique constraint on the hash columns, or a plain index? | Plain non-unique composite index scoped by tenant and organization. | CRM data legitimately contains duplicate emails and shared domains; a unique index would fail the migration on existing data. |
| Q5 | Also fix the `$ilike` substring search in the list routes? | No — out of scope, documented with its root cause. | A hash column cannot serve substring search. The issue itself scopes it out. |
| Q6 | Also cover `primary_phone` (#5515)? | No — the phone axis stays on #5515, with a note that it becomes the same three edits and should fold into this migration if both are scheduled together. | Keeps this one reviewable unit, per the issue's own framing. |
| Q7 | One spec, or split the email and domain axes? | One spec. | Same mechanism, same migration file, same encryption-map edit, same test fixture. Splitting would put two migrations on core tables for no isolation benefit. |
| Q8 | `findCompaniesByDomains` has no in-core caller — ship it anyway? | Ship it, with the exception argued explicitly in API Contracts, and name the deferred `?domain=` list filter as its first caller. | It is the issue's acceptance item 5 and a platform primitive for downstream module developers. Flagged so a maintainer who rejects uncalled exports can drop it without affecting the person axis. |
| Q9 | Route the list routes' `?email=` exact filter through the hash? | No — deferred on API-surface grounds, not on cost. | The mechanical work is small once the column exists (`resolveBaseColumn` resolves any real base column; no reindex is involved), but changing what `?email=` matches is a behavior change for existing callers and interacts with `hasEmail` / `emailStartsWith` / `emailContains` in the same routes. That decision belongs to a maintainer, not to an unattended run. |

No assumption required weakening security, tenant scoping, or a documented compatibility contract, so none is marked `⚠ NEEDS HUMAN CONFIRMATION`.

## 📝 Final Compliance Report

| Gate | Status |
|---|---|
| **Tenant/organization scoping** (predicates and indexes) | ✅ Every helper predicate, both new indexes, the upgrade action, and the backfill iterate per (tenant, organization) scope. The helpers keep the existing early return when `organizationId` is absent. This certifies query scoping only — the digest is a separate question, on the next row. |
| **Digest scoping** | ⚠️ Not tenant-bound: one installation-wide pepper, no `context` on the write side, so equal values yield equal digests across tenants and across all five `*_hash` columns. Deliberate and argued in [Digest scoping](#digest-scoping--the-index-is-salted-per-installation-not-per-tenant); the keyed-HMAC mitigation additionally requires a pepper to be configured ([Configuration precondition](#configuration-precondition--the-keyed-digest-is-not-automatic)). Both are maintainer-visible acceptances rather than resolved gates. |
| **No cross-module ORM relationship** | ✅ The one relation traversed (`CustomerCompanyProfile.entity` → `CustomerEntity`) is intra-module and already exists. `configs` reaches `customers` and `entities` through lazy imports, matching the precedent it copies. |
| **Backward compatibility** (`BACKWARD_COMPATIBILITY.md`) | ✅ Additive under §8: two nullable columns, two indexes, no rename, removal, or narrowing. No exported symbol is removed; `MATCH_CANDIDATE_LIMIT` is retained for `api/people/check-phone/route.ts:11`. `findPeopleByAddresses` keeps its signature. One new upgrade action and one new CLI command are additive registry entries. |
| **Encryption discipline** | ✅ No hand-rolled crypto and no new secret. Reads go through `findWithDecryption` with an explicit `{ tenantId, organizationId }` scope, so they stay on the allowed side of [#5822](https://github.com/open-mercato/open-mercato/pull/5822)'s caller-tenant binding; digests come from `hashForLookup` / `lookupHashCandidates` with no `context`, matching every existing consumer and the write side at `tenantDataEncryptionService.ts:419`. A candidate that fails to decrypt is warned, never silently treated as a non-match. |
| **Validators / API contracts** | ✅ No HTTP route, request schema, or response shape changes; this spec adds the hash columns to no response, no `list.fields` selection, and no index document, and no customers surface exposes them. |
| **i18n** | ⚠️ One new surface: the Step 2 upgrade action needs `messageKey` / `ctaKey` / `successKey` / `loadingKey` entries under `customers.config.upgradeActions.emailDomainHashEncryptionMap.*` in `packages/core/src/modules/customers/i18n/`, following the sibling `customers.seed-interaction-statuses` action, in every locale the module ships (`en`, `de`, `pl` at minimum) so `yarn i18n:check-sync` passes. No other user-facing string is added. |
| **Testing** | ✅ Every step carries a test; the load-bearing ones are Step 2 (persisted-map path), Step 5 (context-free digest, with an explicit pepper so the assertion is not vacuous), Step 7 (soft-delete guard), and the two integration steps — Step 2b (the operator-facing upgrade action, extending `TC-CONF-006`) and Step 8 (inbound matching beyond `MATCH_CANDIDATE_LIMIT`, extending `TC-CRM-EMAIL-*`). Together those two cover every API and UI path this change affects. |
| **Migrations** | ✅ One additive migration plus a snapshot update, generated with `yarn db:generate` and pruned of unrelated output per `AGENTS.md`; no local `yarn db:migrate` run. |

## 📝 Changelog

- **2026-09-04** — Initial spec written from FR [#5765](https://github.com/open-mercato/open-mercato/issues/5765), with nine Open Questions resolved by autonomous defaults.
- **2026-09-06** — Revised after specification review on [#5893](https://github.com/open-mercato/open-mercato/pull/5893): added the "Why the declaration alone is not enough" section and the Step 2 map-reconciliation upgrade action (the `hashField` declaration is read from the persisted `encryption_maps.fields_json`, not from module code, so the original plan was inert for every existing encrypting organization); replaced Step 1's by-construction test with a persisted-map assertion; corrected the two Out-of-scope deferrals, which described the query engine inaccurately (`like`/`ilike` on encrypted base columns is already rerouted through `search_tokens`, and a base column needs no index-document change or reindex); specified the soft-delete guard for `findCompaniesByDomains`; defined the `normalizeDomains` contract; documented the `isEncryptedWithDek` short-circuit and the backfill ordering; softened the performance claim to reflect that `primary_email` carries no index; and added the Overview, Final Compliance Report, and Changelog sections the specs-folder checklist requires. Implementation steps renumbered 1–10.
- **2026-09-09** — Revised after a second specification review on [#5893](https://github.com/open-mercato/open-mercato/pull/5893), which raised three majors the first pass missed. **Step 2 now passes a filtered two-element spec array** to `upsertEncryptionMapSpecs` instead of the customers module's whole eight-map export: the devices precedent it copied is safe only because that module declares one map, while `upsertEncryptionMapSpecs` overwrites `fields_json` unconditionally and `entities/api/encryption.ts:71` lets operators edit these maps at runtime, so the unfiltered form would silently revert operator customizations across all eight customers maps. **The reader now runs its arms as separate sequential queries rather than one `$or`**: Postgres cannot build a `BitmapOr` when one branch is unindexed, so the single-disjunction shape would have left `customer_entities_primary_email_hash_idx` unused by the only query it exists to serve — the performance claims in Proposed Solution and the Risks table are corrected to match, and Step 6 gains tests pinning the arm ordering. **Added an Observability section** requiring two rate-limited warnings from the retained scan, since that scan is what hides the design's own inert state (an unreconciled map or an un-run backfill), including the case where it exhausts `MATCH_CANDIDATE_LIMIT` and returns a false negative. Also: specified the backfill's three-way per-scope map handling so a sweep does not exit non-zero on the majority of scopes that have no `encryption_maps` row; scoped the search-package inertness claim to in-repo callers and noted the public-barrel exposure of `extractHashOnlyFields` / `classifyFields`; corrected the `hashField` user count from four to five and used the fifth (the system-scoped `onboarding:onboarding_request`) to sharpen the persisted-map argument; moved the upgrade action's locale keys to the `customers.config.upgradeActions.*` namespace with an `i18n:check-sync` note; and pathed the `ciphertext-search-warning.ts` citation.
- **2026-09-09 (second revision)** — Revised after a third specification review on [#5893](https://github.com/open-mercato/open-mercato/pull/5893), scoped to four questions the earlier passes did not ask: cross-tenant leakage, salt scoping, the `findWithDecryption` boundary, and integration coverage. No design change; four properties the design already had are now stated. **Added [Digest scoping](#digest-scoping--the-index-is-salted-per-installation-not-per-tenant)** — the pepper is installation-wide (`aes.ts:117-129`) and the write side passes no `context`, so equal values yield equal digests across every tenant and all five `*_hash` columns, while the ciphertext they sit beside is per-tenant (`pbkdf2(root, tenantId)`, `kms.ts:154-159`) and therefore is not correlatable; the Risks and Final Compliance rows that read as blanket tenant-isolation ✅ are split into query scoping and digest scoping so the acceptance is explicit. **Added [Configuration precondition](#configuration-precondition--the-keyed-digest-is-not-automatic)** — `createKmsService()` returns a healthy Vault primary on `VAULT_ADDR`/`VAULT_TOKEN` alone while the pepper comes from a disjoint set of env vars, so encryption-on-with-no-pepper is reachable and every digest is then an unkeyed SHA-256; for the publicly enumerable domain namespace that is a reversible copy of the sealed column, so Steps 2 and 9 now warn (the backfill exits non-zero without writing) and Step 10 names `LOOKUP_HASH_PEPPER`. **Added [The verify step needs a third outcome](#the-verify-step-needs-a-third-outcome-could-not-decrypt)** — the mandatory verify had only "match" and "drop", so a candidate that fails to decrypt was silently reported as a miss, which [#5822](https://github.com/open-mercato/open-mercato/pull/5822) makes reachable and deliberately silent on this exact path (`decryptEntitiesWithFallbackScope`); the reader now counts and warns on undecryptable candidates, passes the decryption scope explicitly, and must never run on a read that declined decryption. **Corrected §UI/UX**, which claimed no user-facing surface while Step 2 ships an operator-clicked CTA with locale keys, and added **Step 2b** integration coverage for it extending `TC-CONF-006`. Also: qualified the "hash columns are internal" claim, which contradicted the §Out of scope argument that `resolveBaseColumn` resolves any real base column; added three Edge Cases rows; and put the changelog entries back in chronological order.
