# Blind index for CRM email and company domain

Tracking issue: [#5765](https://github.com/open-mercato/open-mercato/issues/5765)

## 📝 TLDR

`customers/encryption.ts` seals `customer_entities.primary_email` and `customer_companies.domain` with AES-GCM under a per-write random IV, but declares no `hashField`, and neither table carries a companion `*_hash` column. Any exact-value lookup on those columns therefore matches **zero rows** the moment an organization gets an `encryption_maps` row — and for a dedup or inbound-matching probe, zero rows is the normal, expected answer, so the failure is completely silent. This spec adds the blind-index columns the framework already supports everywhere else (`auth:user.email_hash`, `customer_accounts:customer_user.email_hash`, `messages:message.external_email_hash`), routes the person matcher through them so it stops depending on a 500-row newest-first scan, and adds the company-by-domain helper that does not exist at all today.

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

Declaring `hashField` makes `encryptFields` write `hashForLookup(value)` beside the ciphertext; readers match with `lookupHashCandidates(value)`, which spans the keyed `v2:` HMAC and the legacy unkeyed digest so the migration window keeps working. Four entities already use it — `auth:user.email`, `customer_accounts:customer_user.email`, `customer_accounts:customer_user_invitation.email`, `messages:message.external_email`. `customers` has none of them.

## 📝 Proposed Solution

Add `primary_email_hash` to `customer_entities` and `domain_hash` to `customer_companies`, declare them via `hashField`, and make the lookup helpers query them. Three properties shape the design:

**The hash is a candidate filter, not the verdict.** `encryptFields` skips `null`/`undefined` values, so clearing `domain` to `NULL` leaves the previous `domain_hash` **stale** on the row. A reader that trusted hash equality alone would return a company whose domain was cleared. Every helper therefore confirms the match against the decrypted value it already loads — which also neutralises hash collisions and any future write-path drift. This costs nothing: the helpers already decrypt through `findWithDecryption`.

**Plaintext equality is a correctness arm, not a fallback.** When an organization runs with encryption off the hash column is `NULL`, but the plaintext column holds the raw value, so `WHERE primary_email IN (…)` is exact. Combining both arms in one `$or` covers all four states — encrypted+hashed, plaintext+unhashed, and the two mixed states an organization passes through when encryption is switched on — in a single index-backed round trip.

**The bounded scan is retained as defence-in-depth, not deleted.** Rows written *before* this ships in an *already-encrypted* organization have ciphertext and a `NULL` hash until the backfill runs. Keeping the existing 500-row scan as a last arm means the change can never regress a lookup that works today, and the deployment does not have to be ordered against the backfill. The issue's acceptance criteria explicitly permit this ("bounded scan removed **or kept only as defense-in-depth**").

### Alternatives considered

| Alternative | Why it lost |
|---|---|
| Write the hash unconditionally in the customers write paths, the way `auth` does with `computeEmailHash`, then read hash-only | `auth` touches one email field in a handful of command handlers; `CustomerEntity.primaryEmail` and `CustomerCompanyProfile.domain` are written from `commands/people.ts`, `commands/companies.ts` (create, update, merge, undo, restore), CLI seeds, and import paths. Every missed site silently produces a `NULL` hash — reintroducing the exact silent-zero-row failure class this spec removes. The `$or` reader is correct without touching a single write path. |
| Make encryption deterministic (SIV / fixed IV) for these columns | Hand-rolled deviation from the project's AES-GCM contract, weakens the at-rest guarantee for every consumer of the column, and breaks existing ciphertext. |
| Fix the `$ilike` substring search in the list routes at the same time | A hash column cannot serve substring search; that needs the search-index path and is a different design. Deferred — see Out of scope. |

### Out of scope

- **`primary_phone`** — the same defect on the phone axis, tracked in [#5515](https://github.com/open-mercato/open-mercato/issues/5515). Deliberately excluded so this change stays one reviewable unit. Once this lands, #5515 is the same three edits on one more column; if both are scheduled together the implementer should fold `primary_phone_hash` into this migration rather than adding a second one to `customer_entities`.
- **`$ilike` substring search over sealed columns** — `customers/api/people/route.ts:182,195,197` and `customers/api/companies/route.ts:188,283,285` build `$ilike` terms over `primary_email`, which return nothing on an encrypted organization. Same root cause, not fixable by a hash column.
- **The `?email=` exact filter on the list routes** — `filters.primary_email = { $eq: email }` (`people/route.ts:193`, `companies/route.ts:283`) *is* fixable by a hash, but the list routes filter through the query engine against the index document, so routing them needs `primary_email_hash` added to the indexed field set and a reindex of every customer entity. That is a materially larger blast radius than this issue asks for. Recorded as the natural first follow-up, with the index-document dependency named.

## 📝 Architecture

Nothing new is invented. The change is four edits against existing seams:

| Seam | Change |
|---|---|
| `customers/encryption.ts` | Add `hashField` to the two field rules, plus a doc comment at each map entry pointing at the matcher helper — the reporter states this comment alone would have prevented their bug, and it is where a caller actually looks. |
| `customers/data/entities.ts` | Two nullable `text` columns with a plain index each. |
| `customers/migrations/` | One additive migration; columns and indexes only, no data rewrite. |
| `customers/lib/` | `findPeopleByAddresses` gains the hash arm; `findCompaniesByDomains` is added beside it with the same shape. |

Write-side needs no change at all: `TenantEncryptionSubscriber` already calls `encryptFields`, which populates `rule.hashField` whenever it encrypts.

### Reader shape

Both helpers share one shape, expressed here for the person matcher:

```
1. candidates = lookupHashCandidates(value) for each normalized input   // spans v2: and legacy digests
2. one query:  $or: [ { primaryEmailHash: { $in: allCandidates } },
                      { primaryEmail:     { $in: normalizedValues } } ]
3. verify:     compare each row's DECRYPTED primaryEmail to the requested value; drop non-matches
4. if any input is still unresolved → the existing bounded newest-first scan, verified the same way
```

Step 3 is what makes step 2's cheap arms safe. Step 4 is unchanged from today and disappears on its own once an installation has run the backfill — it simply stops finding anything the first two arms missed.

### Hash computation must stay context-free

`encryptFields` calls `hashForLookup(serialized)` with **no `context` argument** (`tenantDataEncryptionService.ts:419`), while `hashForLookup(value, context?)` accepts one and produces a different digest when given it (`aes.ts:141`; the existing `lookupHash.test.ts` case *"binds the digest to the optional field/entity context"* already asserts that divergence). A reader that passes a context would compute a digest that can never match a stored one — another silent zero-row failure, and one that is invisible at the reader's call site.

The divergence only manifests when a lookup pepper is configured: with no pepper, `hashForLookup` falls back to `legacyHashForLookup(value)`, which ignores `context` entirely, so the context and no-context digests agree. Any test pinning the asymmetry must therefore set a pepper explicitly — otherwise it passes vacuously and pins nothing. Every existing consumer (`auth/lib/emailHash.ts`, `customer_accounts/services/customerUserService.ts`, `messages/api/route.ts`) omits the context, and this spec pins that asymmetry with a test rather than leaving it to convention.

Normalization is handled inside the hash helpers — `normalizeLookupValue` lowercases and trims on both the `v2:` and legacy paths — so case-insensitive matching is inherited, not re-implemented.

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

The hash columns are internal: they are not added to any API response shape, any `list.fields` selection, or any index document.

### Backfill

Rows that predate this change have a `NULL` hash. The backfill **cannot be SQL** — the keyed `v2:` digest needs the pepper from the environment (`LOOKUP_HASH_PEPPER` / `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` / `TENANT_DATA_ENCRYPTION_KEY`), and already-encrypted rows must be decrypted before they can be hashed. It ships as an idempotent CLI command following the module's existing `interactions:backfill` convention and the `auth rotate-encryption-key` precedent, which does exactly this work for `auth:user`:

- `mercato customers lookup-hashes:backfill [--tenant-id …] [--organization-id …] [--dry-run]`
- Processes per (tenant, organization) scope, reading through `findWithDecryption` so encrypted and plaintext rows are handled uniformly.
- Only fills rows where the hash is `NULL` and the source value is non-null; re-running is a no-op.
- Batched with an explicit page size so a large tenant does not load into one unit of work.

Until an operator runs it, the retained bounded scan covers those rows, so the backfill is a performance-and-completeness step, not a correctness prerequisite.

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

`MATCH_CANDIDATE_LIMIT` stays exported — `api/people/check-phone/route.ts:11` imports it, and removing it would be a breaking change to a public surface for no gain.

`findCompaniesByDomains` ships with **no in-core caller**. This is a deliberate, argued exception to the repo's "integrate through real call sites" rule: the helper is the requested deliverable — a platform primitive for module developers who today must write the broken predicate themselves — and its first in-core caller is the deferred `?domain=` list filter. It is exercised by unit tests against both the encrypted and plaintext paths. A maintainer who prefers no uncalled export should drop it from scope and reopen it with the list-route follow-up; the person-axis work stands alone.

`MatchedCompany.id` is the `customer_entities.id` (the anchor other CRM tables link to), not the `customer_companies.id`, matching `MatchedPerson.id` and what every caller actually needs.

## 📝 UI/UX

None. No user-facing surface changes: no route, screen, copy, or response field is added or modified. The only visible effect is that lookups which silently returned nothing on encrypted organizations now return the right row.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| Organization has no `encryption_maps` row | Hash stays `NULL`; the plaintext arm matches exactly. Identical to today's fast path. |
| Organization encrypts; row written after this ships | Hash written by `encryptFields`; hash arm matches. |
| Organization encrypts; row written *before* this ships, backfill not yet run | Both cheap arms miss; the retained bounded scan resolves it exactly as today. No regression. |
| Row written while encryption was off, organization later encrypts | Row stays plaintext with `NULL` hash until it is next written; the plaintext arm matches throughout. |
| `domain` (or `primary_email`) cleared to `NULL` | `encryptFields` skips null values, so the stale hash survives on the row. The verify-against-decrypted-value step drops the row, so the helper does not return it. |
| Two rows share an email / domain | Both are returned as candidates; the helper emits one match per input value, first verified row wins — the existing `findPeopleByAddresses` contract, unchanged. |
| Pepper is rotated or newly configured | `lookupHashCandidates` returns both the `v2:` and legacy digests, so reads keep matching pre-rotation rows; re-running the backfill recomputes them. |
| Hash collision, or a hash written by a future drifting write path | The verify step compares the decrypted value, so a false candidate is never emitted as a match. |
| Backfill interrupted midway | Idempotent and `NULL`-guarded; re-run resumes. Partially backfilled data is still correct because of the retained scan. |
| Backfill hits an undecryptable row (missing DEK) | Skip, count, and report it; never write a hash derived from ciphertext, which would poison the index with a value no reader can ever produce. |

## 📝 Risks & Impact Review

| Risk | Assessment |
|---|---|
| **Blast radius** | Two nullable columns and two indexes on core tables, one encryption-map edit, one changed helper, one new helper, one new CLI command. No write path, API contract, or UI touched. |
| **Backward compatibility** | Additive only per `BACKWARD_COMPATIBILITY.md` §8 (DB schema) — new nullable columns, no removals, no narrowing. `data/entities.ts` gains properties; no export is removed or renamed. `MATCH_CANDIDATE_LIMIT` is retained for its existing importer. |
| **Index creation lock** | MikroORM runs migrations in a transaction, so `CREATE INDEX CONCURRENTLY` is not available. `customer_entities` and `customer_companies` are organization-scoped CRM tables, not append-only event tables, so a plain index build is a short lock. An operator with an unusually large tenant should build the indexes out-of-band before applying the migration. |
| **Security** | A blind index is a deliberate, documented trade-off already made four times in this codebase: it makes the sealed value equality-searchable to anyone with database access and the pepper. Mitigated by the keyed `v2:` HMAC (`hashForLookup`), which is why `legacyHashForLookup` is deprecated. No new secret, no new hand-rolled crypto, no plaintext at rest. |
| **Tenant isolation** | Both indexes and every helper predicate are scoped by `tenant_id` and `organization_id`; the helpers keep their existing early return when `organizationId` is absent. |
| **Rollback** | Each phase is independently revertible. Reverting the reader restores today's behavior exactly (the scan never left). Reverting the migration drops two unread nullable columns — no data loss, because the hash is derived, never authoritative. |
| **Performance** | Strictly better: the common path becomes one index-backed query instead of decrypting up to 500 rows in memory. |

## 📋 Phasing

Each phase leaves the application working and ships independently.

- **Phase 1 — The blind index.** Columns, `hashField` declarations, migration, and the write-side tests. Nothing reads the columns yet; behavior is unchanged.
- **Phase 2 — Route the readers.** `findPeopleByAddresses` gains the hash arm; `findCompaniesByDomains` is added; doc comments land at the encryption-map seam.
- **Phase 3 — Backfill.** The CLI command that fills hashes for pre-existing rows.

## 📋 Implementation Plan

### Phase 1 — The blind index

**Step 1.** Add `hashField` to the two rules in `packages/core/src/modules/customers/encryption.ts` (`primary_email` → `primary_email_hash`, `domain` → `domain_hash`), with a doc comment on each map entry stating that the column is not queryable by value and naming the helper to use instead (`findPeopleByAddresses`, `findCompaniesByDomains`).
*Test:* unit test asserting both rules carry the expected `hashField`.

**Step 2.** Add `primaryEmailHash` to `CustomerEntity` and `domainHash` to `CustomerCompanyProfile` in `data/entities.ts` — nullable `text`, with the composite indexes from the Data Model section.
*Test:* covered by Step 3's migration test and the typecheck gate.

**Step 3.** Generate the additive migration with `yarn db:generate`, keeping only the two columns and two indexes, and update `migrations/.snapshot-open-mercato.json`. Per `AGENTS.md`, delete any unrelated generated output rather than applying migrations locally.
*Test:* migration test asserting both columns and both indexes exist after up, and are gone after down.

**Step 4.** Pin the write-side contract: a unit test over `TenantDataEncryptionService.encryptEntityPayload` for `customers:customer_entity` and `customers:customer_company_profile` asserting (a) the hash column is populated beside the ciphertext, (b) the stored value equals `hashForLookup(plaintext)` computed **without** a `context` argument, and (c) it does **not** equal `hashForLookup(plaintext, 'customers:customer_entity:primary_email')` — the asymmetry from `aes.ts:141` that would otherwise be discovered as a silent zero-row failure. The test **must set a lookup pepper** (`LOOKUP_HASH_PEPPER`) in its setup and clear it in teardown, following the `clearLookupEnv` pattern in `lookupHash.test.ts`: with no pepper both digests fall back to `legacyHashForLookup`, assertion (c) holds vacuously, and the test pins nothing. Assert the same holds when the value needs normalizing (mixed case, surrounding whitespace).

### Phase 2 — Route the readers

**Step 5.** Rewrite the body of `findPeopleByAddresses` to the four-step reader shape: `lookupHashCandidates` per normalized address, one `$or` query over `primaryEmailHash` and `primaryEmail`, verification against the decrypted `primaryEmail`, then the retained bounded scan for anything still unresolved. Signature, `MatchedPerson`, `normalizeAddresses`, and `MATCH_CANDIDATE_LIMIT` are unchanged; update the doc comment so it describes the hash arm instead of pointing at #5515 as future work.
*Test:* unit tests for each row of the Edge Cases table that applies to the person axis — encrypted+hashed, plaintext+unhashed, encrypted+unhashed (scan arm), stale hash after clearing, duplicate emails, and mixed-case input.

**Step 6.** Add `packages/core/src/modules/customers/lib/findCompaniesByDomains.ts` with `normalizeDomains` (trim, lowercase, reject empty and whitespace-bearing values), `MatchedCompany`, and `findCompaniesByDomains` — the same four-step shape, querying `CustomerCompanyProfile.domainHash` / `domain` and returning the owning `customer_entities.id`. Scope every query by `tenantId`/`organizationId` and keep the `kind='company'` guarantee via the profile's owning entity.
*Test:* the mirror of Step 5's unit tests on the domain axis, plus a test asserting the returned id is the entity id and not the profile id.

**Step 7.** Integration coverage for the inbound-matching path that consumes the matcher (`lib/link-channel-message-handler.ts` → `findPeopleByAddresses`), extending the existing `__integration__/TC-CRM-EMAIL-*` family: an organization with an `encryption_maps` row, a person whose email was written under encryption, and an inbound message that must link to that person. The test must be self-contained per `.ai/qa/AGENTS.md` — create the encrypted-organization fixture in setup and clean up in teardown, without relying on seeded data. Assert the link resolves for a person old enough to fall outside `MATCH_CANDIDATE_LIMIT`, which is the case that fails today.

### Phase 3 — Backfill

**Step 8.** Add `lookup-hashes:backfill` to `packages/core/src/modules/customers/cli.ts` following the `interactions:backfill` command shape and the `auth rotate-encryption-key` scope-iteration precedent: optional `--tenant-id` / `--organization-id` / `--dry-run`, per-scope batched iteration, fills only `NULL` hashes over non-null source values, skips and reports undecryptable rows, and prints a per-scope count.
*Test:* unit test over the backfill routine asserting it fills a plaintext row and an encrypted row, leaves an already-hashed row untouched, is a no-op on the second run, and skips an undecryptable row without writing.

**Step 9.** Document the operational step: a short section in the customers module `AGENTS.md` (or the module's docs page, wherever the module documents CLI commands) stating that installations with tenant data encryption enabled should run the backfill once after upgrading, and that lookups degrade to the bounded scan until they do.

### Validation

Run the repository's configured gate from `.ai/agentic.config.json` in order: `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.

## Resolved assumptions (autonomous defaults)

This spec was written by an unattended run; every Open Question was resolved with the most reversible, lowest-blast-radius answer. Each is listed with its rationale so a maintainer can override before merge.

| # | Question | Resolution | Rationale |
|---|---|---|---|
| Q1 | Who writes the hash — the encryption subscriber via `hashField`, or also the customers write paths unconditionally? | `hashField` only; no write path is touched. | The `auth` pattern of writing the hash explicitly means auditing every create/update/merge/undo/restore site in `commands/people.ts` and `commands/companies.ts` plus CLI seeds and import paths, where a single missed site silently reintroduces the bug. The `$or` reader is correct without any of that. |
| Q2 | Reader shape — hash-only, or dual-arm? | Three arms: hash equality, plaintext equality, then the retained bounded scan; every arm verified against the decrypted value. | Hash-only regresses plaintext organizations and pre-backfill rows. The three-arm shape cannot regress any lookup that works today, which decouples the deployment from the backfill. |
| Q3 | Backfill in the migration, or a CLI command? | A separate idempotent CLI command, `customers lookup-hashes:backfill`. | The keyed digest needs the environment pepper and encrypted rows need decrypting, so raw SQL cannot compute either. Follows the module's `interactions:backfill` convention and the `auth rotate-encryption-key` precedent. |
| Q4 | Unique constraint on the hash columns, or a plain index? | Plain non-unique composite index scoped by tenant and organization. | CRM data legitimately contains duplicate emails and shared domains; a unique index would fail the migration on existing data. |
| Q5 | Also fix the `$ilike` substring search in the list routes? | No — out of scope, documented with its root cause. | A hash column cannot serve substring search. The issue itself scopes it out. |
| Q6 | Also cover `primary_phone` (#5515)? | No — the phone axis stays on #5515, with a note that it becomes the same three edits and should fold into this migration if both are scheduled together. | Keeps this one reviewable unit, per the issue's own framing. |
| Q7 | One spec, or split the email and domain axes? | One spec. | Same mechanism, same migration file, same encryption-map edit, same test fixture. Splitting would put two migrations on core tables for no isolation benefit. |
| Q8 | `findCompaniesByDomains` has no in-core caller — ship it anyway? | Ship it, with the exception argued explicitly in API Contracts, and name the deferred `?domain=` list filter as its first caller. | It is the issue's acceptance item 5 and a platform primitive for downstream module developers. Flagged so a maintainer who rejects uncalled exports can drop it without affecting the person axis. |
| Q9 | Route the list routes' `?email=` exact filter through the hash? | No — deferred, with the index-document dependency named in Out of scope. | It is genuinely fixable by a hash, but only by adding the column to the indexed field set and reindexing every customer entity — a materially larger blast radius than this issue asks for. |

No assumption required weakening security, tenant scoping, or a documented compatibility contract, so none is marked `⚠ NEEDS HUMAN CONFIRMATION`.
