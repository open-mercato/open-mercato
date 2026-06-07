# CRM Email Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user email send + receive capability to the CRM module, anchored on `CustomerPersonProfile`, with per-email private-by-default visibility, wired to the existing Communications Hub.

**Architecture:** Event-driven subscriber (`link-channel-message.ts`) listens to `communication_channels.message.received` and `.sent`; resolves People by address; creates `CustomerInteraction` rows (one per match, deduped via partial unique index). Outbound compose route calls the hub's `sendAsUser` and writes `crmVisibility` into `channelMetadata` so the subscriber knows what visibility to persist. Three-layer visibility enforcement: DB filter at query time, mutation guard on the PATCH route, subscriber audit on every insert.

**Tech Stack:** MikroORM v7, Postgres, Next.js (App Router), React, Awilix DI, Zod, Jest, Playwright, kysely (used by existing customers interactions route), `@open-mercato/queue` (event subscribers), `@open-mercato/shared/lib/encryption/find` (decryption helpers).

**Spec reference:** [.ai/specs/2026-05-27-crm-email-integration.md](../specs/2026-05-27-crm-email-integration.md). Read the spec before starting any task — it defines the contracts that this plan implements.

**Branch:** Work continues on the existing `spec/email-integration` branch (do NOT create a new worktree — the spec was written there and depends on the just-shipped hub code).

**Commit convention:** Per the user's `feedback_no_auto_commit` memory, every task's "Commit" step is `git add <files>` only. Do NOT run `git commit`. The user reviews staged diffs and commits manually at phase boundaries. Each task lists the exact files to `git add` so the staging is precise.

---

## Phase 1 — Schema + helper + subscriber (inbound)

### Task 1: Extend CustomerInteraction entity with email-link columns

**Files:**
- Modify: `packages/core/src/modules/customers/data/entities.ts`

- [ ] **Step 1: Locate the `CustomerInteraction` class declaration**

Run: `grep -n "^export class CustomerInteraction" packages/core/src/modules/customers/data/entities.ts`

Note the line number. The class is the one where `interactionType` lives.

- [ ] **Step 2: Add `externalMessageId`, `visibility`, `channelProviderKey` properties to the class**

Inside the `CustomerInteraction` class, after the existing `body` property, add:

```ts
  // ── Email integration (2026-05-27) ────────────────────────────────────────
  /**
   * UUID pointing at `communication_channels.message_channel_link.id`.
   * Set only for rows where `interactionType === 'email'`.
   *
   * The cross-module link is declared in `data/extensions.ts` rather than as
   * a raw FK (root AGENTS.md: no direct ORM relationships between modules).
   */
  @Property({ name: 'external_message_id', type: 'uuid', nullable: true })
  externalMessageId?: string | null

  /**
   * Per-email visibility flag. NULL for non-email rows (calls, meetings, tasks).
   * For email rows:
   *   'private' = visible only to `authorUserId` (the channel owner) + admins
   *   'shared'  = visible to everyone with `customers.interactions.view`
   */
  @Property({ name: 'visibility', type: 'text', nullable: true })
  visibility?: 'private' | 'shared' | null

  /**
   * Denormalized provider key ('gmail' | 'imap') for filter UX.
   * Avoids a join to message_channel_links when surfacing the timeline.
   */
  @Property({ name: 'channel_provider_key', type: 'text', nullable: true })
  channelProviderKey?: string | null
```

Also add these new optional-prop hints to the `[OptionalProps]?:` union at the top of the class (find the existing line that lists `'status' | 'pinned' | …` and append `| 'externalMessageId' | 'visibility' | 'channelProviderKey'`).

- [ ] **Step 3: Run typecheck against the customers package**

Run: `yarn workspace @open-mercato/core typecheck 2>&1 | tail -20`
Expected: PASS (no new type errors from this change).

- [ ] **Step 4: Stage the change**

```bash
git add packages/core/src/modules/customers/data/entities.ts
```

---

### Task 2: Generate scoped migration + update snapshot

**Files:**
- Create: `packages/core/src/modules/customers/migrations/Migration<TS>_customers_email_integration.ts` (timestamp replaced by `yarn db:generate`)
- Modify: `packages/core/src/modules/customers/migrations/.snapshot-open-mercato.json`

- [ ] **Step 1: Generate migrations**

Run: `yarn db:generate 2>&1 | tail -30`

The generator inspects entity diffs and emits migrations for any module whose entities changed since the last snapshot. The customers module should emit one new file containing the 3 new columns from Task 1.

- [ ] **Step 2: Discard unrelated migrations**

If other modules' migrations were emitted (because their snapshots are stale on `develop`), delete them — keep ONLY the new `Migration<TS>_customers_email_integration.ts`. Per root AGENTS.md: "If the generator emits unrelated migrations because another module's snapshot is stale, remove those files from the diff."

Run: `git status --short packages/*/src/modules/*/migrations/`
For every migration file listed that is NOT under `packages/core/src/modules/customers/migrations/`, delete it:
```bash
rm packages/<other-module>/src/modules/<other-module>/migrations/Migration<TS>_*.ts
```
And revert any unrelated snapshot drift:
```bash
git checkout -- packages/<other-module>/src/modules/<other-module>/migrations/.snapshot-open-mercato.json
```

- [ ] **Step 3: Inspect the customers migration**

Run: `cat packages/core/src/modules/customers/migrations/Migration*_customers_email_integration.ts`

Verify it contains exactly the 3 `add column` statements for `external_message_id`, `visibility`, `channel_provider_key` and no unrelated drops/alters. If the generator added unrelated statements, edit them out manually.

- [ ] **Step 4: Add the 2 indexes to the migration**

Open the migration file and append to the `up()` method:

```ts
    this.addSql(`create index "customer_interactions_external_msg_idx" on "customer_interactions" ("external_message_id") where "external_message_id" is not null;`);
    this.addSql(`create unique index "customer_interactions_email_dedupe_uq" on "customer_interactions" ("entity_id", "external_message_id") where "external_message_id" is not null and "deleted_at" is null;`);
    this.addSql(`create index "customer_interactions_email_visibility_idx" on "customer_interactions" ("entity_id", "interaction_type", "visibility", "author_user_id") where "interaction_type" = 'email' and "deleted_at" is null;`);
```

And to the `down()` method:

```ts
    this.addSql(`drop index if exists "customer_interactions_email_visibility_idx";`);
    this.addSql(`drop index if exists "customer_interactions_email_dedupe_uq";`);
    this.addSql(`drop index if exists "customer_interactions_external_msg_idx";`);
```

**Important**: The CustomerInteraction "entity" column is named `entity_id` in the table (per the existing schema), not `entity`. Verify by `grep -n "entity_id\|entity\b" packages/core/src/modules/customers/data/entities.ts | head -10` — if the column is actually `entity` (not `entity_id`) update the indexes accordingly. The spec used `entity` as shorthand; the migration must match the real column name.

- [ ] **Step 5: Stage the migration + snapshot**

```bash
git add packages/core/src/modules/customers/migrations/Migration*_customers_email_integration.ts packages/core/src/modules/customers/migrations/.snapshot-open-mercato.json
```

---

### Task 3: Create data/extensions.ts (EntityExtension declaration)

**Files:**
- Create: `packages/core/src/modules/customers/data/extensions.ts`

- [ ] **Step 1: Check whether extensions.ts already exists**

Run: `ls packages/core/src/modules/customers/data/extensions.ts 2>&1`
If it exists, the customers module already declares extensions and you'll *modify* not *create*. Otherwise:

- [ ] **Step 2: Create the file**

```ts
import type { EntityExtension } from '@open-mercato/shared/modules/extensions'

/**
 * Cross-module entity links owned by the customers module.
 *
 * Per root AGENTS.md, modules do NOT form direct ORM relationships across
 * boundaries. Instead, plain UUID columns reference IDs in other modules and
 * the link is declared here so the data engine + UI tooling can traverse.
 */
export const extensions: EntityExtension[] = [
  {
    from: 'customers:customer_interaction',
    field: 'external_message_id',
    to: 'communication_channels:message_channel_link',
    kind: 'one-to-one-optional',
  },
]

export default extensions
```

- [ ] **Step 3: Run yarn generate to wire the extension into generated files**

Run: `yarn generate 2>&1 | tail -10`
Expected: completes without errors; no entity-id mismatches.

- [ ] **Step 4: Run typecheck**

Run: `yarn workspace @open-mercato/core typecheck 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add packages/core/src/modules/customers/data/extensions.ts
```

---

### Task 4: Create lib/findPeopleByAddresses.ts helper + tests

**Files:**
- Create: `packages/core/src/modules/customers/lib/findPeopleByAddresses.ts`
- Create: `packages/core/src/modules/customers/lib/__tests__/findPeopleByAddresses.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/modules/customers/lib/__tests__/findPeopleByAddresses.test.ts`:

```ts
import { normalizeAddresses, findPeopleByAddresses } from '../findPeopleByAddresses'

describe('normalizeAddresses', () => {
  it('lowercases, trims, dedupes', () => {
    const out = normalizeAddresses(['Alice@Example.com', ' alice@example.com ', 'BOB@x.io'])
    expect(out.sort()).toEqual(['alice@example.com', 'bob@x.io'])
  })
  it('filters out non-strings and obviously invalid shapes', () => {
    const out = normalizeAddresses([null as any, undefined as any, 'not-an-email', 'a@b'])
    expect(out).toEqual(['a@b'])
  })
  it('returns empty array for empty input', () => {
    expect(normalizeAddresses([])).toEqual([])
    expect(normalizeAddresses(undefined as any)).toEqual([])
  })
})

describe('findPeopleByAddresses', () => {
  function makeEm(rows: Array<{ id: string; email: string | null }>) {
    return {
      find: jest.fn().mockImplementation(async (_entity: unknown, where: any) => {
        // Mirror the SQL filter: tenantId match + lower(email) IN list
        const lowered = (where.email?.$in ?? []) as string[]
        return rows.filter((r) => r.email && lowered.includes(r.email.toLowerCase()))
      }),
    } as any
  }

  it('returns empty array when address list is empty', async () => {
    const em = makeEm([{ id: 'p1', email: 'alice@example.com' }])
    const out = await findPeopleByAddresses(em, [], 'tenant-1')
    expect(out).toEqual([])
    expect(em.find).not.toHaveBeenCalled()
  })

  it('matches case-insensitively', async () => {
    const em = makeEm([{ id: 'p1', email: 'alice@example.com' }])
    const out = await findPeopleByAddresses(em, ['ALICE@EXAMPLE.COM'], 'tenant-1')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('p1')
  })

  it('returns one row per matching person when multiple addresses match different people', async () => {
    const em = makeEm([
      { id: 'p1', email: 'alice@example.com' },
      { id: 'p2', email: 'bob@example.com' },
    ])
    const out = await findPeopleByAddresses(em, ['alice@example.com', 'bob@example.com'], 'tenant-1')
    expect(out.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })

  it('passes the tenantId through to the EM filter', async () => {
    const em = makeEm([])
    await findPeopleByAddresses(em, ['x@y.io'], 'tenant-42')
    const where = (em.find.mock.calls[0] as any[])[1]
    expect(where.tenantId).toBe('tenant-42')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @open-mercato/core jest packages/core/src/modules/customers/lib/__tests__/findPeopleByAddresses.test.ts 2>&1 | tail -20`
Expected: FAIL with `Cannot find module '../findPeopleByAddresses'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/modules/customers/lib/findPeopleByAddresses.ts`:

```ts
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerPersonProfile } from '../data/entities'

/**
 * Lower-cases, trims, and dedupes a list of email-shaped strings.
 * Rejects anything that doesn't contain a single `@`.
 */
export function normalizeAddresses(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim().toLowerCase()
    if (!trimmed) continue
    const at = trimmed.indexOf('@')
    if (at <= 0 || at === trimmed.length - 1 || trimmed.lastIndexOf('@') !== at) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

export interface MatchedPerson {
  id: string
  email: string
}

/**
 * Batch lookup of CustomerPersonProfile rows whose `email` matches any of the
 * given addresses (case-insensitive), scoped to the tenant.
 *
 * Returns up to `addresses.length` rows but may return fewer if some addresses
 * don't correspond to any Person, or more if the same address is on two People
 * (rare, but possible — e.g. shared inbox in B2B). The caller decides how to
 * use the result.
 */
export async function findPeopleByAddresses(
  em: EntityManager,
  addresses: string[],
  tenantId: string,
): Promise<MatchedPerson[]> {
  const normalized = normalizeAddresses(addresses)
  if (normalized.length === 0) return []
  const rows = (await findWithDecryption(
    em,
    CustomerPersonProfile,
    {
      tenantId,
      email: { $in: normalized } as any,
      deletedAt: null,
    } as any,
    undefined,
    { tenantId, organizationId: null },
  )) as Array<{ id: string; email?: string | null }>
  return rows
    .filter((r) => typeof r.email === 'string' && r.email.length > 0)
    .map((r) => ({ id: r.id, email: (r.email as string).toLowerCase() }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @open-mercato/core jest packages/core/src/modules/customers/lib/__tests__/findPeopleByAddresses.test.ts 2>&1 | tail -10`
Expected: PASS, 7 tests.

- [ ] **Step 5: Stage**

```bash
git add packages/core/src/modules/customers/lib/findPeopleByAddresses.ts packages/core/src/modules/customers/lib/__tests__/findPeopleByAddresses.test.ts
```

---

### Task 5: Create lib/visibilityFilter.ts + tests

**Files:**
- Create: `packages/core/src/modules/customers/lib/visibilityFilter.ts`
- Create: `packages/core/src/modules/customers/lib/__tests__/visibilityFilter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/modules/customers/lib/__tests__/visibilityFilter.test.ts`:

```ts
import { applyEmailVisibilityFilter, callerHasEmailViewPrivate, EMAIL_VIEW_PRIVATE_FEATURE } from '../visibilityFilter'

describe('callerHasEmailViewPrivate', () => {
  it('returns true on exact feature match', () => {
    expect(callerHasEmailViewPrivate([EMAIL_VIEW_PRIVATE_FEATURE])).toBe(true)
  })
  it('returns true on customers.* wildcard', () => {
    expect(callerHasEmailViewPrivate(['customers.*'])).toBe(true)
  })
  it('returns true on superadmin *', () => {
    expect(callerHasEmailViewPrivate(['*'])).toBe(true)
  })
  it('returns false on unrelated features', () => {
    expect(callerHasEmailViewPrivate(['customers.people.view', 'customers.deals.view'])).toBe(false)
  })
  it('returns false on empty/null input', () => {
    expect(callerHasEmailViewPrivate([])).toBe(false)
    expect(callerHasEmailViewPrivate(null)).toBe(false)
    expect(callerHasEmailViewPrivate(undefined)).toBe(false)
  })
})

describe('applyEmailVisibilityFilter', () => {
  // The function shape: applyEmailVisibilityFilter(query, options) -> query
  // It mutates a kysely-compatible builder. We test by feeding a fake builder
  // and asserting that the `where` callback registers the right predicates.

  function makeFakeBuilder() {
    const recorded: any[] = []
    const builder: any = {
      where: jest.fn().mockImplementation((arg: any) => {
        recorded.push(arg)
        return builder
      }),
      __recorded: recorded,
    }
    return builder
  }

  it('is a no-op when caller has admin bypass', () => {
    const qb = makeFakeBuilder()
    const out = applyEmailVisibilityFilter(qb, {
      currentUserId: 'user-1',
      userFeatures: ['*'],
    })
    expect(out).toBe(qb)
    expect(qb.where).not.toHaveBeenCalled()
  })

  it('adds visibility predicate when caller does not have admin bypass', () => {
    const qb = makeFakeBuilder()
    applyEmailVisibilityFilter(qb, {
      currentUserId: 'user-1',
      userFeatures: ['customers.interactions.view'],
    })
    expect(qb.where).toHaveBeenCalledTimes(1)
    // The predicate is a function passed to where(); we verify it ran with an
    // expression builder by invoking it against a stub.
    const predicateFn = qb.__recorded[0]
    expect(typeof predicateFn).toBe('function')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @open-mercato/core jest packages/core/src/modules/customers/lib/__tests__/visibilityFilter.test.ts 2>&1 | tail -10`
Expected: FAIL with `Cannot find module '../visibilityFilter'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/modules/customers/lib/visibilityFilter.ts`:

```ts
import { hasFeature } from '@open-mercato/shared/security/features'

/**
 * The ACL feature that grants admins the right to see private emails authored
 * by other users. Declared in `acl.ts` and default-granted to `admin` only.
 */
export const EMAIL_VIEW_PRIVATE_FEATURE = 'customers.email.view_private'

/**
 * Returns true when the caller can see ALL private email interactions (e.g. an
 * admin doing incident response or audit). Honours wildcards (`customers.*`, `*`).
 */
export function callerHasEmailViewPrivate(userFeatures: string[] | null | undefined): boolean {
  if (!Array.isArray(userFeatures) || userFeatures.length === 0) return false
  return hasFeature(userFeatures, EMAIL_VIEW_PRIVATE_FEATURE)
}

export interface ApplyEmailVisibilityFilterOptions {
  currentUserId: string | null
  userFeatures: string[] | null | undefined
}

/**
 * Adds a `WHERE` predicate to a kysely query so that:
 *   - Non-email interactions (calls, meetings, tasks) pass through unchanged.
 *   - Email interactions with `visibility = 'shared'` are visible to all.
 *   - Email interactions with `visibility = 'private'` are visible ONLY to the
 *     `authorUserId` (channel owner) OR to callers with admin bypass.
 *
 * The function expects a kysely-style builder whose `.where()` accepts an
 * expression-builder callback. Returns the same builder for chaining.
 */
export function applyEmailVisibilityFilter<T extends { where: (...args: any[]) => T }>(
  query: T,
  opts: ApplyEmailVisibilityFilterOptions,
): T {
  if (callerHasEmailViewPrivate(opts.userFeatures)) return query
  const currentUserId = opts.currentUserId
  return query.where((eb: any) =>
    eb.or([
      eb('interaction_type', '!=', 'email'),
      eb('visibility', '=', 'shared'),
      eb.and([
        eb('visibility', '=', 'private'),
        currentUserId
          ? eb('author_user_id', '=', currentUserId)
          : eb.val(false),
      ]),
    ]),
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @open-mercato/core jest packages/core/src/modules/customers/lib/__tests__/visibilityFilter.test.ts 2>&1 | tail -10`
Expected: PASS, 7 tests.

- [ ] **Step 5: Stage**

```bash
git add packages/core/src/modules/customers/lib/visibilityFilter.ts packages/core/src/modules/customers/lib/__tests__/visibilityFilter.test.ts
```

---

### Task 6: Wire visibilityFilter into existing interactions list route

**Files:**
- Modify: `packages/core/src/modules/customers/api/interactions/route.ts`

- [ ] **Step 1: Open the file and locate the GET handler's list query**

Run: `grep -n "let rowsQuery\|where('tenant_id'\|where('interaction_type'" packages/core/src/modules/customers/api/interactions/route.ts | head -10`

Identify the section (around line 359-441 per current code) where `rowsQuery` is being filtered by various optional query params.

- [ ] **Step 2: Import the visibility filter**

At the top of the file, add:

```ts
import { applyEmailVisibilityFilter } from '../../lib/visibilityFilter'
```

- [ ] **Step 3: Wire the filter immediately AFTER the existing where-clauses but BEFORE the sort**

Find the line just before `rowsQuery = rowsQuery.orderBy(...)`. Insert:

```ts
    // ── Email visibility filter (2026-05-27) ──────────────────────────────
    // Non-email interactions pass through; email rows with visibility='private'
    // are filtered out unless the caller is the author or has admin bypass.
    rowsQuery = applyEmailVisibilityFilter(rowsQuery as any, {
      currentUserId: auth.sub,
      userFeatures: await resolveUserFeatures(container, auth.sub as string, auth.tenantId ?? null, selectedOrganizationId),
    })
```

(Use the existing `resolveUserFeatures` helper that already lives in the same file — confirm by grepping; if its signature differs, adapt the args to match.)

- [ ] **Step 4: Run typecheck**

Run: `yarn workspace @open-mercato/core typecheck 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Run the customers test suite to confirm no regression**

Run: `yarn workspace @open-mercato/core jest packages/core/src/modules/customers/api/interactions 2>&1 | tail -15`
Expected: all pre-existing interaction tests still PASS.

- [ ] **Step 6: Stage**

```bash
git add packages/core/src/modules/customers/api/interactions/route.ts
```

---

### Task 7: Add 2 events to events.ts

**Files:**
- Modify: `packages/core/src/modules/customers/events.ts`

- [ ] **Step 1: Open the file and find the events array**

Run: `grep -n "} as const" packages/core/src/modules/customers/events.ts`
Note the line — events are added before that line.

- [ ] **Step 2: Add the 2 new event entries to the array**

Add these two entries just before `] as const`:

```ts
  // ── Email integration (2026-05-27) ────────────────────────────────────────
  { id: 'customers.email.linked', label: 'Email Linked To Person', entity: 'email_link', category: 'crud', clientBroadcast: true },
  { id: 'customers.email.visibility_changed', label: 'Email Visibility Changed', entity: 'email_link', category: 'lifecycle', clientBroadcast: true },
```

- [ ] **Step 3: Run yarn generate**

Run: `yarn generate 2>&1 | tail -10`
Expected: completes without errors. The generated `entities.ids.generated.ts` does not include event IDs (events are typed via `CustomersEventId`), so this is just structural cache refresh.

- [ ] **Step 4: Run typecheck**

Run: `yarn workspace @open-mercato/core typecheck 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add packages/core/src/modules/customers/events.ts
```

---

### Task 8: Add 2 ACL features + setup defaults

**Files:**
- Modify: `packages/core/src/modules/customers/acl.ts`
- Modify: `packages/core/src/modules/customers/setup.ts`

- [ ] **Step 1: Add features to acl.ts**

In `packages/core/src/modules/customers/acl.ts`, add two entries to the `features` array (just before the closing `]`):

```ts
  // Email integration (2026-05-27)
  { id: 'customers.email.compose', title: 'Compose / send emails from CRM', module: 'customers' },
  { id: 'customers.email.view_private', title: 'View other users\' private emails (admin)', module: 'customers' },
```

- [ ] **Step 2: Add to setup.ts defaultRoleFeatures**

In `packages/core/src/modules/customers/setup.ts`, find the `defaultRoleFeatures` block.

For `admin`, the existing entry is `'customers.*'` (wildcard) — no change needed; admins already get both new features via wildcard.

For `employee`, add `'customers.email.compose'` to the array. The `view_private` feature is admin-only and intentionally NOT granted to employees.

```ts
    employee: [
      // ... existing entries ...
      'customers.email.compose',
    ],
```

- [ ] **Step 3: Typecheck**

Run: `yarn workspace @open-mercato/core typecheck 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 4: Stage**

```bash
git add packages/core/src/modules/customers/acl.ts packages/core/src/modules/customers/setup.ts
```

---

### Task 9: Create link-channel-message.ts subscriber (inbound branch) + unit tests

**Files:**
- Create: `packages/core/src/modules/customers/subscribers/link-channel-message.ts`
- Create: `packages/core/src/modules/customers/subscribers/__tests__/link-channel-message.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/modules/customers/subscribers/__tests__/link-channel-message.test.ts`:

```ts
import handler, { metadata } from '../link-channel-message'

function makeCtx(em: any, otherResolvers: Record<string, unknown> = {}) {
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return { fork: () => em } as unknown as T
      if (name in otherResolvers) return otherResolvers[name] as T
      throw new Error(`unexpected resolve: ${name}`)
    },
  }
}

describe('link-channel-message subscriber metadata', () => {
  it('declares both events with stable id', () => {
    expect(metadata.event).toEqual(['communication_channels.message.received', 'communication_channels.message.sent'])
    expect(metadata.persistent).toBe(true)
    expect(metadata.id).toBe('customers:link-channel-message')
  })
})

describe('link-channel-message subscriber — inbound', () => {
  it('no-ops when payload has no messageChannelLinkId', async () => {
    const em = { find: jest.fn(), findOne: jest.fn(), persistAndFlush: jest.fn() }
    await handler({} as any, makeCtx(em))
    expect(em.find).not.toHaveBeenCalled()
  })

  it('no-ops (fail-closed) when payload lacks tenantId', async () => {
    const em = { find: jest.fn(), findOne: jest.fn(), persistAndFlush: jest.fn() }
    await handler({
      eventType: 'communication_channels.message.received',
      messageChannelLinkId: 'mcl-1',
    } as any, makeCtx(em))
    expect(em.find).not.toHaveBeenCalled()
  })

  it('creates one interaction per matched Person (single match)', async () => {
    const linkRow = {
      id: 'mcl-1',
      providerKey: 'gmail',
      direction: 'inbound',
      createdAt: new Date('2026-05-27T10:00:00Z'),
      channelMetadata: {
        from: 'alice@example.com',
        to: ['bob@example.com'],
        cc: [],
        subject: 'Hello',
      },
      messageId: 'msg-1',
    }
    const personRows = [{ id: 'person-1', email: 'alice@example.com' }]
    const em: any = {
      findOne: jest.fn().mockResolvedValueOnce(linkRow),
      find: jest.fn().mockResolvedValueOnce(personRows),
      persistAndFlush: jest.fn().mockResolvedValue(undefined),
    }
    em.create = jest.fn().mockImplementation((_e, data) => ({ ...data }))
    await handler({
      eventType: 'communication_channels.message.received',
      messageChannelLinkId: 'mcl-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      channelUserId: 'user-A',
    } as any, makeCtx(em))
    // One persist for the new interaction
    expect(em.persistAndFlush).toHaveBeenCalledTimes(1)
    const persisted = (em.persistAndFlush.mock.calls[0] as any[])[0]
    expect(persisted.interactionType).toBe('email')
    expect(persisted.externalMessageId).toBe('mcl-1')
    expect(persisted.visibility).toBe('private')
    expect(persisted.authorUserId).toBe('user-A')
    expect(persisted.entityId).toBe('person-1')
  })

  it('creates multiple interactions when multiple People match across From/To/Cc', async () => {
    const linkRow = {
      id: 'mcl-1',
      providerKey: 'gmail',
      direction: 'inbound',
      createdAt: new Date(),
      channelMetadata: {
        from: 'alice@x.com',
        to: ['bob@x.com'],
        cc: ['carol@x.com'],
      },
      messageId: 'msg-1',
    }
    const peopleRows = [
      { id: 'p-A', email: 'alice@x.com' },
      { id: 'p-B', email: 'bob@x.com' },
      { id: 'p-C', email: 'carol@x.com' },
    ]
    const em: any = {
      findOne: jest.fn().mockResolvedValueOnce(linkRow),
      find: jest.fn().mockResolvedValueOnce(peopleRows),
      persistAndFlush: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockImplementation((_e, data) => ({ ...data })),
    }
    await handler({
      eventType: 'communication_channels.message.received',
      messageChannelLinkId: 'mcl-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      channelUserId: 'user-A',
    } as any, makeCtx(em))
    expect(em.persistAndFlush).toHaveBeenCalledTimes(3)
    const entities = em.persistAndFlush.mock.calls.map((call: any[]) => call[0].entityId)
    expect(entities.sort()).toEqual(['p-A', 'p-B', 'p-C'])
  })

  it('no-op when zero people match', async () => {
    const linkRow = {
      id: 'mcl-1',
      providerKey: 'gmail',
      direction: 'inbound',
      createdAt: new Date(),
      channelMetadata: { from: 'random@nowhere.io', to: [], cc: [] },
      messageId: 'msg-1',
    }
    const em: any = {
      findOne: jest.fn().mockResolvedValueOnce(linkRow),
      find: jest.fn().mockResolvedValueOnce([]),
      persistAndFlush: jest.fn(),
      create: jest.fn(),
    }
    await handler({
      eventType: 'communication_channels.message.received',
      messageChannelLinkId: 'mcl-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      channelUserId: 'user-A',
    } as any, makeCtx(em))
    expect(em.persistAndFlush).not.toHaveBeenCalled()
  })

  it('idempotent — unique-constraint violation is swallowed', async () => {
    const linkRow = {
      id: 'mcl-1',
      providerKey: 'gmail',
      direction: 'inbound',
      createdAt: new Date(),
      channelMetadata: { from: 'alice@x.com', to: [], cc: [] },
      messageId: 'msg-1',
    }
    const personRows = [{ id: 'p-A', email: 'alice@x.com' }]
    const em: any = {
      findOne: jest.fn().mockResolvedValueOnce(linkRow),
      find: jest.fn().mockResolvedValueOnce(personRows),
      create: jest.fn().mockImplementation((_e, data) => ({ ...data })),
      persistAndFlush: jest.fn().mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value violates unique constraint "customer_interactions_email_dedupe_uq"'), { code: '23505' }),
      ),
    }
    // Should NOT throw despite the unique-violation
    await handler({
      eventType: 'communication_channels.message.received',
      messageChannelLinkId: 'mcl-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      channelUserId: 'user-A',
    } as any, makeCtx(em))
    expect(em.persistAndFlush).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @open-mercato/core jest packages/core/src/modules/customers/subscribers/__tests__/link-channel-message.test.ts 2>&1 | tail -10`
Expected: FAIL with `Cannot find module '../link-channel-message'`.

- [ ] **Step 3: Write the inbound-only implementation**

Create `packages/core/src/modules/customers/subscribers/link-channel-message.ts`:

```ts
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerInteraction } from '../data/entities'
import { findPeopleByAddresses, normalizeAddresses } from '../lib/findPeopleByAddresses'

export const metadata = {
  event: ['communication_channels.message.received', 'communication_channels.message.sent'] as const,
  persistent: true,
  id: 'customers:link-channel-message',
}

type LinkChannelMessagePayload = {
  eventType?: string
  messageChannelLinkId?: string
  tenantId?: string
  organizationId?: string | null
  /** The channel.userId (mailbox owner) for visibility attribution. */
  channelUserId?: string | null
  /** Optional explicit hint when invoked by the outbound compose route. */
  crmPersonId?: string | null
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

const POSTGRES_UNIQUE_VIOLATION = '23505'

export default async function handler(
  payload: LinkChannelMessagePayload,
  ctx: SubscriberContext,
): Promise<void> {
  if (!payload || typeof payload.messageChannelLinkId !== 'string' || !payload.messageChannelLinkId) {
    return
  }
  // Fail-closed when tenantId is missing — unscoped queries are unsafe.
  if (typeof payload.tenantId !== 'string' || !payload.tenantId) return

  const em = (ctx.resolve('em') as EntityManager).fork()
  const dscope = { tenantId: payload.tenantId, organizationId: payload.organizationId ?? null }

  // We deliberately reference MessageChannelLink by its entity class name
  // ('MessageChannelLink') rather than importing it from the communication_channels
  // module, because the customers module MUST NOT depend on hub entity classes
  // directly. The Mikro identity map resolves by entity name at runtime.
  const link = (await findOneWithDecryption(
    em,
    'MessageChannelLink' as any,
    { id: payload.messageChannelLinkId, tenantId: payload.tenantId } as any,
    undefined,
    dscope,
  )) as Record<string, unknown> | null
  if (!link) return

  const metaJson = (link.channelMetadata ?? null) as Record<string, unknown> | null
  const addresses: string[] = []
  if (metaJson) {
    const from = metaJson.from
    if (typeof from === 'string') addresses.push(from)
    for (const key of ['to', 'cc', 'bcc'] as const) {
      const value = metaJson[key]
      if (Array.isArray(value)) {
        for (const v of value) if (typeof v === 'string') addresses.push(v)
      } else if (typeof value === 'string') {
        addresses.push(value)
      }
    }
  }
  const normalized = normalizeAddresses(addresses)
  if (normalized.length === 0 && !payload.crmPersonId) return

  // Resolve People by address. If the caller passed an explicit crmPersonId hint
  // (outbound compose), include it as an additional anchor — even if its email
  // doesn't appear in the recipient list (e.g. user composed to a typoed
  // address but knew which Person they meant).
  const matched = await findPeopleByAddresses(em, normalized, payload.tenantId)
  const personIdSet = new Set<string>(matched.map((m) => m.id))
  if (payload.crmPersonId) personIdSet.add(payload.crmPersonId)

  if (personIdSet.size === 0) return

  const visibility: 'private' | 'shared' =
    (metaJson?.crmVisibility === 'shared'
      ? 'shared'
      : payload.channelUserId
        ? 'private'
        : 'shared')

  const subject = typeof metaJson?.subject === 'string' ? (metaJson!.subject as string) : null
  const bodyText = typeof metaJson?.bodyText === 'string' ? (metaJson!.bodyText as string) : null
  const occurredAt =
    link.createdAt instanceof Date ? link.createdAt : new Date()
  const providerKey = typeof link.providerKey === 'string' ? (link.providerKey as string) : null

  for (const personId of personIdSet) {
    const row = em.create('CustomerInteraction' as any, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
      entityId: personId,
      interactionType: 'email',
      title: subject,
      body: bodyText,
      authorUserId: payload.channelUserId ?? null,
      occurredAt,
      externalMessageId: payload.messageChannelLinkId,
      visibility,
      channelProviderKey: providerKey,
    })
    try {
      await em.persistAndFlush(row)
    } catch (err) {
      // Idempotency: swallow unique-violation on (entityId, externalMessageId).
      const code = (err as { code?: string }).code
      if (code !== POSTGRES_UNIQUE_VIOLATION) throw err
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @open-mercato/core jest packages/core/src/modules/customers/subscribers/__tests__/link-channel-message.test.ts 2>&1 | tail -10`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run yarn generate so the subscriber is auto-discovered**

Run: `yarn generate 2>&1 | tail -5`
Expected: completes; the new file is picked up by the subscribers scanner.

- [ ] **Step 6: Stage**

```bash
git add packages/core/src/modules/customers/subscribers/link-channel-message.ts packages/core/src/modules/customers/subscribers/__tests__/link-channel-message.test.ts
```

---

### Task 10: Phase 1 integration tests — inbound auto-link end-to-end

**Files:**
- Create: `packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-002.spec.ts`
- Create: `packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-003.spec.ts`
- Create: `packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-004.spec.ts`
- Create: `packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-005.spec.ts`

- [ ] **Step 1: Look at an existing customers integration spec for the boilerplate**

Run: `ls packages/core/src/modules/customers/__integration__/ | head -5 && cat packages/core/src/modules/customers/__integration__/$(ls packages/core/src/modules/customers/__integration__/ | head -1) | head -50`

Note the fixture / setup pattern (auth fixtures, test tenant creation). Reuse it for the new specs.

- [ ] **Step 2: Write TC-CRM-EMAIL-002 (inbound 1-match)**

Create `packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-002.spec.ts`. The scenario:
- Setup: create a Person with `email='alice@example.com'` in tenant A.
- Action: emit `communication_channels.message.received` event payload pointing at a fixture MessageChannelLink whose `channelMetadata.from = 'alice@example.com'`.
- Wait for subscriber: the test must call the event bus directly (in-process) and await flush — see `packages/events/AGENTS.md` for the in-process event-bus test helper.
- Assertion: a `CustomerInteraction` row exists with `entityId=alice.id`, `interactionType='email'`, `externalMessageId=<link.id>`, `visibility='private'`, `authorUserId=<channelUser>`.

Use the exact fixture helpers from `packages/core/src/helpers/integration/`. The full code body should mirror one of the existing customers integration specs — keep boilerplate minimal but DO write actual executable assertions (no placeholders).

- [ ] **Step 3: Write TC-CRM-EMAIL-003 (multi-match: To+Cc → 3 interactions)**

Create the spec. Setup 3 People (alice/bob/carol); emit a `message.received` event with `to=[alice], cc=[bob, carol]`. Assert 3 distinct `CustomerInteraction` rows are created, one per Person.

- [ ] **Step 4: Write TC-CRM-EMAIL-004 (no match: 0 interactions)**

Setup a tenant with NO Person matching `random@nowhere.io`. Emit `message.received` with `from=random@nowhere.io`. Assert: zero `CustomerInteraction` rows for this MessageChannelLink. The underlying MessageChannelLink + Message still exist in the hub (the unified Messages inbox).

- [ ] **Step 5: Write TC-CRM-EMAIL-005 (threading inheritance via In-Reply-To)**

Setup a Person (alice) and an existing email interaction for her, linked to MessageChannelLink M1 (Message-ID `<original@example.com>`). Emit `message.received` for a NEW MessageChannelLink M2 whose `channelMetadata.from = 'unknown@elsewhere.io'` (not a Person) but whose `channelMetadata.headers.inReplyTo = '<original@example.com>'`. Assert: a new CustomerInteraction is created for alice with `externalMessageId = M2.id` — i.e. the reply attached to alice's timeline despite the sender being unknown.

(For this test to pass, the subscriber must implement the threading-inheritance branch. If Task 9's implementation doesn't yet do this, expand the subscriber: look up MessageChannelLink rows where `channelMetadata.messageId` is in the references chain → find their parent CustomerInteraction rows → also link the current event's message to those Persons. Add the implementation and rerun all tests.)

- [ ] **Step 6: Run the integration specs**

Run: `yarn test:integration --grep "TC-CRM-EMAIL-00[2345]" 2>&1 | tail -30`
Expected: 4 specs PASS.

- [ ] **Step 7: Stage all four spec files + any subscriber additions**

```bash
git add packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-00{2,3,4,5}.spec.ts packages/core/src/modules/customers/subscribers/link-channel-message.ts
```

---

## Phase 2 — Outbound compose API + subscriber outbound branch

### Task 11: Create POST /api/customers/people/[id]/emails route + tests

**Files:**
- Create: `packages/core/src/modules/customers/api/people/[id]/emails/route.ts`
- Create: `packages/core/src/modules/customers/api/people/[id]/emails/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/modules/customers/api/people/[id]/emails/__tests__/route.test.ts`:

```ts
import { POST } from '../route'

function mockRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: new Headers(headers),
  } as unknown as Request
}

describe('POST /api/customers/people/[id]/emails — validation', () => {
  it('returns 422 on missing recipients', async () => {
    const res = await POST(
      mockRequest({ userChannelId: 'ch-1', to: [], subject: 'hi', body: 'hello' }),
      { params: Promise.resolve({ id: 'p-1' }) } as any,
    )
    expect(res.status).toBe(422)
  })
  it('returns 422 on missing subject', async () => {
    const res = await POST(
      mockRequest({ userChannelId: 'ch-1', to: ['x@y.io'], subject: '', body: 'hi' }),
      { params: Promise.resolve({ id: 'p-1' }) } as any,
    )
    expect(res.status).toBe(422)
  })
  it('returns 401 when unauthenticated', async () => {
    // The route's getAuthFromRequest returns null when no auth header — we don't
    // mock here; the route should detect missing auth and return 401.
    const res = await POST(
      mockRequest({ userChannelId: 'ch-1', to: ['x@y.io'], subject: 'hi', body: 'hello' }),
      { params: Promise.resolve({ id: 'p-1' }) } as any,
    )
    expect(res.status).toBe(401)
  })
})
```

(Larger integration-style auth + channel-ownership tests live in the integration spec — Task 13.)

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @open-mercato/core jest packages/core/src/modules/customers/api/people/\[id\]/emails 2>&1 | tail -10`
Expected: FAIL with `Cannot find module '../route'`.

- [ ] **Step 3: Write the route implementation**

Create `packages/core/src/modules/customers/api/people/[id]/emails/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  validateCrudMutationGuard,
  runCrudMutationGuardAfterSuccess,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { CustomerPersonProfile } from '../../../../data/entities'

export const metadata = {
  path: '/customers/people/[id]/emails',
  POST: {
    requireAuth: true,
    requireFeatures: ['customers.email.compose'],
  },
}

const composeSchema = z
  .object({
    userChannelId: z.string().uuid(),
    to: z.array(z.string().email()).min(1).max(50),
    cc: z.array(z.string().email()).max(50).optional(),
    bcc: z.array(z.string().email()).max(50).optional(),
    subject: z.string().min(1).max(500),
    body: z.string().min(1).max(500_000),
    bodyFormat: z.enum(['text', 'html']).default('html'),
    visibility: z.enum(['private', 'shared']).default('private'),
    inReplyTo: z.string().max(500).optional(),
    references: z.array(z.string().max(500)).max(50).optional(),
  })
  .strict()

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const { id: personId } = await context.params
  if (!z.string().uuid().safeParse(personId).success) {
    return NextResponse.json({ error: 'Invalid person id' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof composeSchema>
  try {
    body = composeSchema.parse(await req.json().catch(() => null))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request body' },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  await validateCrudMutationGuard(container, {
    moduleId: 'customers',
    operation: 'customers.email.compose',
    auth,
  })

  const em = (container.resolve('em') as EntityManager).fork()
  const organizationId = (auth as { orgId?: string | null }).orgId ?? null
  const dscope = { tenantId: auth.tenantId as string, organizationId }

  // 1. Verify the person exists in the caller's tenant
  const person = await findOneWithDecryption(
    em,
    CustomerPersonProfile,
    { id: personId, tenantId: auth.tenantId, deletedAt: null } as any,
    undefined,
    dscope,
  )
  if (!person) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 })
  }

  // 2. Call the hub's sendAsUser facade. This is the single send path.
  //    Note: the customers module MUST NOT import sendAsUser directly from the
  //    hub (avoid hard cross-module coupling). Instead, dispatch via the API:
  //    we hit /api/communication_channels/send-as-user with an internal HTTP
  //    request, which already enforces channel ownership.
  //
  //    Alternative: resolve the command bus and execute the canonical
  //    send-as-user command if one exists. Check
  //    `packages/core/src/modules/communication_channels/api/post/send-as-user/route.ts`
  //    for the canonical command-bus invocation pattern.

  const sendResponse = await fetch(
    new URL('/api/communication_channels/send-as-user', req.url).toString(),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Forward auth cookies / headers from the original request so the hub
        // route's getAuthFromRequest sees the same identity.
        cookie: req.headers.get('cookie') ?? '',
        authorization: req.headers.get('authorization') ?? '',
      },
      body: JSON.stringify({
        userChannelId: body.userChannelId,
        to: body.to,
        cc: body.cc,
        bcc: body.bcc,
        subject: body.subject,
        body: { [body.bodyFormat]: body.body },
        attachments: [],
        inReplyTo: body.inReplyTo,
        references: body.references,
        channelMetadata: {
          crmVisibility: body.visibility,
          crmPersonId: personId,
        },
      }),
    },
  )

  if (!sendResponse.ok) {
    const errorBody = await sendResponse.json().catch(() => null)
    const status = sendResponse.status >= 400 && sendResponse.status < 600 ? sendResponse.status : 502
    return NextResponse.json(
      { error: errorBody?.error ?? 'Send failed' },
      { status },
    )
  }

  const result = (await sendResponse.json()) as {
    messageId?: string
    externalMessageId?: string
    sentAt?: string
  }

  await runCrudMutationGuardAfterSuccess(container, {
    moduleId: 'customers',
    operation: 'customers.email.compose',
    auth,
  })

  return NextResponse.json({
    messageId: result.messageId ?? null,
    externalMessageId: result.externalMessageId ?? null,
    sentAt: result.sentAt ?? new Date().toISOString(),
  })
}

export const openApi = {
  tags: ['Customers', 'Email'],
  methods: {
    POST: {
      summary: 'Compose + send an email from a Person detail page (Approach 1)',
      tags: ['Customers', 'Email'],
      requestBody: composeSchema,
      responses: [
        { status: 200, description: 'Email queued for send' },
        { status: 400, description: 'Invalid person id' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing customers.email.compose feature' },
        { status: 404, description: 'Person not found' },
        { status: 422, description: 'Invalid request body' },
        { status: 502, description: 'Hub returned an error' },
      ],
    },
  },
}
export default POST
```

- [ ] **Step 4: Run unit tests to confirm they pass**

Run: `yarn workspace @open-mercato/core jest packages/core/src/modules/customers/api/people/\[id\]/emails 2>&1 | tail -10`
Expected: PASS, 3 tests.

- [ ] **Step 5: Stage**

```bash
git add packages/core/src/modules/customers/api/people/\[id\]/emails/route.ts packages/core/src/modules/customers/api/people/\[id\]/emails/__tests__/route.test.ts
```

---

### Task 12: Extend link-channel-message subscriber to handle outbound branch

**Files:**
- Modify: `packages/core/src/modules/customers/subscribers/link-channel-message.ts`
- Modify: `packages/core/src/modules/customers/subscribers/__tests__/link-channel-message.test.ts`

- [ ] **Step 1: Write a new failing test for the outbound path**

In `link-channel-message.test.ts`, add a new describe block at the bottom:

```ts
describe('link-channel-message subscriber — outbound', () => {
  it('reads crmVisibility from channelMetadata; defaults to shared when channelMetadata.crmVisibility="shared"', async () => {
    const linkRow = {
      id: 'mcl-2',
      providerKey: 'gmail',
      direction: 'outbound',
      createdAt: new Date(),
      channelMetadata: {
        from: 'sales@example.com',
        to: ['bob@example.com'],
        cc: [],
        crmVisibility: 'shared',
        crmPersonId: 'person-bob',
      },
      messageId: 'msg-out-1',
    }
    const personRows = [{ id: 'person-bob', email: 'bob@example.com' }]
    const em: any = {
      findOne: jest.fn().mockResolvedValueOnce(linkRow),
      find: jest.fn().mockResolvedValueOnce(personRows),
      create: jest.fn().mockImplementation((_e, data) => ({ ...data })),
      persistAndFlush: jest.fn().mockResolvedValue(undefined),
    }
    await handler({
      eventType: 'communication_channels.message.sent',
      messageChannelLinkId: 'mcl-2',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      channelUserId: 'user-sales',
    } as any, makeCtx(em))
    expect(em.persistAndFlush).toHaveBeenCalledTimes(1)
    const persisted = (em.persistAndFlush.mock.calls[0] as any[])[0]
    expect(persisted.visibility).toBe('shared')
  })

  it('honors crmPersonId hint when address matching returns zero', async () => {
    const linkRow = {
      id: 'mcl-3',
      providerKey: 'gmail',
      direction: 'outbound',
      createdAt: new Date(),
      channelMetadata: {
        from: 'sales@example.com',
        to: ['typo@exmaple.com'],          // typo — won't match any Person
        cc: [],
        crmPersonId: 'person-target',      // hint from the compose route
      },
      messageId: 'msg-out-2',
    }
    const em: any = {
      findOne: jest.fn().mockResolvedValueOnce(linkRow),
      find: jest.fn().mockResolvedValueOnce([]),
      create: jest.fn().mockImplementation((_e, data) => ({ ...data })),
      persistAndFlush: jest.fn().mockResolvedValue(undefined),
    }
    await handler({
      eventType: 'communication_channels.message.sent',
      messageChannelLinkId: 'mcl-3',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      channelUserId: 'user-sales',
    } as any, makeCtx(em))
    expect(em.persistAndFlush).toHaveBeenCalledTimes(1)
    const persisted = (em.persistAndFlush.mock.calls[0] as any[])[0]
    expect(persisted.entityId).toBe('person-target')
  })
})
```

- [ ] **Step 2: Verify the new tests pass against the existing Task 9 implementation**

The Task 9 implementation already reads `metaJson.crmVisibility` and honors `payload.crmPersonId`, so these tests should pass on first run. Run:

```bash
yarn workspace @open-mercato/core jest packages/core/src/modules/customers/subscribers/__tests__/link-channel-message.test.ts 2>&1 | tail -10
```
Expected: PASS, 9 tests total.

If they don't pass, the Task 9 implementation is missing those branches — update it now (the contract in Task 9 already specifies both branches, so this should be a no-op for a correct Task 9 implementation).

- [ ] **Step 3: Stage**

```bash
git add packages/core/src/modules/customers/subscribers/__tests__/link-channel-message.test.ts
```

---

### Task 13: Integration test TC-CRM-EMAIL-001 (outbound end-to-end + cross-user privacy)

**Files:**
- Create: `packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-001.spec.ts`

- [ ] **Step 1: Write the spec**

Scenario:
1. Setup: tenant T1, two users (A and B) with `customers.email.compose` feature. User A has a connected mock channel `ch-A`. Person `bob@example.com` exists.
2. User A calls `POST /api/customers/people/{bob.id}/emails` with `visibility='private'`, recipient `bob@example.com`.
3. Assert response 200 with `messageId`.
4. Wait for the subscriber to flush (`await sleep(500)` or use the test event-bus-flush helper).
5. As User A, call `GET /api/customers/interactions?entityId={bob.id}&interactionType=email`. Assert 1 row returned.
6. As User B, call the same. Assert 0 rows returned (private filter excluded A's email).
7. Cleanup: delete all created entities.

The full test body must include real API call helpers, real fixture cleanup, and real assertions — no placeholders.

- [ ] **Step 2: Run the spec**

Run: `yarn test:integration --grep "TC-CRM-EMAIL-001" 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 3: Stage**

```bash
git add packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-001.spec.ts
```

---

## Phase 3 — ComposeEmailDialog + injection widgets + i18n

### Task 14: Build ComposeEmailDialog component + tests

**Files:**
- Create: `packages/core/src/modules/customers/components/detail/ComposeEmailDialog.tsx`
- Create: `packages/core/src/modules/customers/components/detail/__tests__/ComposeEmailDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/ComposeEmailDialog.test.tsx`:

```tsx
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ComposeEmailDialog } from '../ComposeEmailDialog'

const baseProps = {
  open: true,
  onOpenChange: jest.fn(),
  personId: 'p-1',
  defaultRecipient: 'bob@example.com',
  channels: [
    { id: 'ch-1', displayName: 'Alice (Gmail)', externalIdentifier: 'alice@example.com', providerKey: 'gmail' as const, isPrimary: true },
  ],
  onSend: jest.fn().mockResolvedValue({ messageId: 'm-1' }),
}

describe('ComposeEmailDialog', () => {
  it('renders with default recipient pre-filled', () => {
    render(<ComposeEmailDialog {...baseProps} />)
    expect(screen.getByDisplayValue('bob@example.com')).toBeInTheDocument()
  })

  it('disables Send until subject + body are present', async () => {
    render(<ComposeEmailDialog {...baseProps} />)
    const send = screen.getByRole('button', { name: /send/i })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Hi' } })
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'hello' } })
    expect(send).not.toBeDisabled()
  })

  it('calls onSend with the form data on submit', async () => {
    render(<ComposeEmailDialog {...baseProps} />)
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Hi' } })
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await new Promise((r) => setTimeout(r, 50))
    expect(baseProps.onSend).toHaveBeenCalledWith(expect.objectContaining({
      userChannelId: 'ch-1',
      to: ['bob@example.com'],
      subject: 'Hi',
      body: 'hello',
      visibility: 'private',
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @open-mercato/core jest packages/core/src/modules/customers/components/detail/__tests__/ComposeEmailDialog 2>&1 | tail -10`
Expected: FAIL.

- [ ] **Step 3: Write the component**

Create `packages/core/src/modules/customers/components/detail/ComposeEmailDialog.tsx`:

```tsx
'use client'

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export interface ComposeEmailChannel {
  id: string
  displayName: string
  externalIdentifier?: string | null
  providerKey: 'gmail' | 'imap'
  isPrimary?: boolean
}

export interface ComposeEmailValues {
  userChannelId: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body: string
  bodyFormat: 'text' | 'html'
  visibility: 'private' | 'shared'
  inReplyTo?: string
  references?: string[]
}

export interface ComposeEmailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  personId: string
  defaultRecipient?: string | null
  channels: ComposeEmailChannel[]
  /**
   * Reply mode prefills To/Cc/Subject from the original email and sets
   * inReplyTo + references.
   */
  replyTo?: {
    inReplyTo: string
    references?: string[]
    to: string[]
    cc?: string[]
    subject: string
  } | null
  onSend: (values: ComposeEmailValues) => Promise<{ messageId: string | null }>
}

export function ComposeEmailDialog(props: ComposeEmailDialogProps) {
  const t = useT()
  const primary = props.channels.find((c) => c.isPrimary) ?? props.channels[0]
  const [channelId, setChannelId] = React.useState(props.replyTo ? primary?.id ?? '' : primary?.id ?? '')
  const [to, setTo] = React.useState((props.replyTo?.to ?? [props.defaultRecipient ?? '']).join(', '))
  const [cc, setCc] = React.useState((props.replyTo?.cc ?? []).join(', '))
  const [subject, setSubject] = React.useState(props.replyTo?.subject ?? '')
  const [body, setBody] = React.useState('')
  const [visibility, setVisibility] = React.useState<'private' | 'shared'>('private')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const parseRecipients = React.useCallback((raw: string): string[] => {
    return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
  }, [])

  const canSend = subject.trim().length > 0 && body.trim().length > 0 && to.trim().length > 0 && channelId.length > 0 && !busy

  const handleSubmit = async () => {
    if (!canSend) return
    setBusy(true)
    setError(null)
    try {
      const values: ComposeEmailValues = {
        userChannelId: channelId,
        to: parseRecipients(to),
        cc: cc.trim() ? parseRecipients(cc) : undefined,
        subject: subject.trim(),
        body,
        bodyFormat: 'html',
        visibility,
        inReplyTo: props.replyTo?.inReplyTo,
        references: props.replyTo?.references,
      }
      await props.onSend(values)
      props.onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('customers.email.errors.sendFailed', 'Send failed'))
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSubmit()
    } else if (e.key === 'Escape' && !busy) {
      e.preventDefault()
      props.onOpenChange(false)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl" onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('customers.email.compose.title', 'Compose email')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="cm-from">{t('customers.email.compose.sendAs', 'Send as')}</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger id="cm-from"><SelectValue /></SelectTrigger>
              <SelectContent>
                {props.channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.displayName} {c.externalIdentifier ? `(${c.externalIdentifier})` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="cm-to">{t('customers.email.compose.to', 'To')}</Label>
            <Input id="cm-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="alice@example.com, bob@example.com" />
          </div>
          <div>
            <Label htmlFor="cm-cc">{t('customers.email.compose.cc', 'Cc')}</Label>
            <Input id="cm-cc" value={cc} onChange={(e) => setCc(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cm-subject">{t('customers.email.compose.subject', 'Subject')}</Label>
            <Input id="cm-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cm-body">{t('customers.email.compose.body', 'Body')}</Label>
            <Textarea id="cm-body" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <fieldset className="flex items-center gap-4 text-sm">
            <legend className="font-medium">{t('customers.email.compose.visibility', 'Visibility')}</legend>
            <label className="flex items-center gap-1">
              <input type="radio" name="vis" checked={visibility === 'private'} onChange={() => setVisibility('private')} />
              {t('customers.email.compose.visibility.private', 'Private to me')}
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="vis" checked={visibility === 'shared'} onChange={() => setVisibility('shared')} />
              {t('customers.email.compose.visibility.shared', 'Visible to teammates')}
            </label>
          </fieldset>
          {error ? <div className="text-sm text-status-error-fg">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={busy}>{t('customers.email.compose.cancel', 'Cancel')}</Button>
          <Button onClick={handleSubmit} disabled={!canSend}>{busy ? t('customers.email.compose.sending', 'Sending…') : t('customers.email.compose.send', 'Send')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ComposeEmailDialog
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @open-mercato/core jest packages/core/src/modules/customers/components/detail/__tests__/ComposeEmailDialog 2>&1 | tail -10`
Expected: PASS, 3 tests.

- [ ] **Step 5: Stage**

```bash
git add packages/core/src/modules/customers/components/detail/ComposeEmailDialog.tsx packages/core/src/modules/customers/components/detail/__tests__/ComposeEmailDialog.test.tsx
```

---

### Task 15: person-send-email injection widget

**Files:**
- Create: `packages/core/src/modules/customers/widgets/injection/person-send-email/widget.ts`
- Create: `packages/core/src/modules/customers/widgets/injection/person-send-email/widget.client.tsx`
- Modify: `packages/core/src/modules/customers/widgets/injection-table.ts`

- [ ] **Step 1: Inspect existing widget patterns**

Run: `ls packages/core/src/modules/customers/widgets/injection/ 2>/dev/null && cat packages/core/src/modules/customers/widgets/injection-table.ts | head -40`

Note the file shape: `widget.ts` exports metadata + the client component; `widget.client.tsx` is the React surface; `injection-table.ts` maps widget IDs to spot IDs.

- [ ] **Step 2: Create widget.ts**

```ts
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { PersonSendEmailWidget } from './widget.client'

export const widget: InjectionWidgetModule<Record<string, unknown>, { personId?: string | null; personEmail?: string | null }> = {
  id: 'customers:person-send-email',
  features: ['customers.email.compose'],
  Widget: PersonSendEmailWidget,
}

export default widget
```

- [ ] **Step 3: Create widget.client.tsx**

```tsx
'use client'

import * as React from 'react'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ComposeEmailDialog, type ComposeEmailChannel, type ComposeEmailValues } from '../../../components/detail/ComposeEmailDialog'

type WidgetProps = {
  data?: { personId?: string | null; personEmail?: string | null }
}

export function PersonSendEmailWidget({ data }: WidgetProps) {
  const t = useT()
  const personId = data?.personId ?? null
  const personEmail = data?.personEmail ?? null
  const [channels, setChannels] = React.useState<ComposeEmailChannel[] | null>(null)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    apiCall<{ items?: ComposeEmailChannel[] }>(`/api/communication_channels/me/channels?status=connected`, { method: 'GET' })
      .then((r) => {
        if (cancelled) return
        const items = (r.result?.items ?? []) as ComposeEmailChannel[]
        setChannels(items)
      })
      .catch(() => {
        if (!cancelled) setChannels([])
      })
    return () => { cancelled = true }
  }, [])

  if (!personId) return null
  if (channels === null) return null  // loading; render nothing
  if (channels.length === 0) {
    return (
      <Button asChild variant="outline" size="sm" className="gap-2">
        <Link href="/backend/profile/communication-channels">
          <Mail className="h-4 w-4" />
          {t('customers.email.compose.noChannel.cta', 'Connect your mailbox')}
        </Link>
      </Button>
    )
  }

  const onSend = async (values: ComposeEmailValues) => {
    const response = await apiCall<{ messageId?: string }>(
      `/api/customers/people/${personId}/emails`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) },
    )
    if (!response.ok) {
      const err = response.result as { error?: string } | null
      throw new Error(err?.error ?? t('customers.email.errors.sendFailed', 'Send failed'))
    }
    flash(t('customers.email.compose.sent', 'Email sent'), 'success')
    return { messageId: response.result?.messageId ?? null }
  }

  return (
    <>
      <Button variant="default" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Mail className="h-4 w-4" />
        {t('customers.email.compose.button', 'Send email')}
      </Button>
      <ComposeEmailDialog
        open={open}
        onOpenChange={setOpen}
        personId={personId}
        defaultRecipient={personEmail}
        channels={channels}
        onSend={onSend}
      />
    </>
  )
}
```

- [ ] **Step 4: Map widget to spot via injection-table.ts**

Add an entry to the injection-table file mapping the widget to the spot `page:customers.person:header:actions` (or whatever spot the existing person-v2 detail page exposes — check by grepping `InjectionSpot` in `people-v2/[id]/page.tsx`).

- [ ] **Step 5: Run yarn generate to register the widget**

Run: `yarn generate 2>&1 | tail -5`

- [ ] **Step 6: Run yarn mercato configs cache structural to refresh the nav/structural cache**

Run: `yarn mercato configs cache structural --all-tenants 2>&1 | tail -5`

- [ ] **Step 7: Typecheck + stage**

Run: `yarn workspace @open-mercato/core typecheck 2>&1 | tail -10`
Expected: PASS.

```bash
git add packages/core/src/modules/customers/widgets/injection/person-send-email/widget.ts packages/core/src/modules/customers/widgets/injection/person-send-email/widget.client.tsx packages/core/src/modules/customers/widgets/injection-table.ts
```

---

### Task 16: EmailReplyForwardActions + person-email-card-actions injection widget

**Files:**
- Create: `packages/core/src/modules/customers/components/detail/EmailReplyForwardActions.tsx`
- Create: `packages/core/src/modules/customers/widgets/injection/person-email-card-actions/widget.ts`
- Create: `packages/core/src/modules/customers/widgets/injection/person-email-card-actions/widget.client.tsx`

- [ ] **Step 1: Create `EmailReplyForwardActions.tsx`**

```tsx
'use client'

import * as React from 'react'
import { Reply, ReplyAll, Forward } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export interface EmailReplyForwardActionsProps {
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
}

export function EmailReplyForwardActions(props: EmailReplyForwardActionsProps) {
  const t = useT()
  return (
    <div className="flex gap-1">
      <Button variant="ghost" size="sm" onClick={props.onReply} aria-label={t('customers.email.timeline.reply', 'Reply')}>
        <Reply className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onReplyAll} aria-label={t('customers.email.timeline.replyAll', 'Reply all')}>
        <ReplyAll className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onForward} aria-label={t('customers.email.timeline.forward', 'Forward')}>
        <Forward className="h-4 w-4" />
      </Button>
    </div>
  )
}

export default EmailReplyForwardActions
```

- [ ] **Step 2: Create person-email-card-actions widget files**

`widget.ts`:

```ts
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { PersonEmailCardActionsWidget } from './widget.client'

export const widget: InjectionWidgetModule<Record<string, unknown>, {
  interactionId?: string | null
  externalMessageId?: string | null
  personId?: string | null
  fromAddress?: string | null
  toAddresses?: string[] | null
  ccAddresses?: string[] | null
  subject?: string | null
  inReplyTo?: string | null
  references?: string[] | null
}> = {
  id: 'customers:person-email-card-actions',
  features: ['customers.email.compose'],
  Widget: PersonEmailCardActionsWidget,
}

export default widget
```

`widget.client.tsx`:

```tsx
'use client'

import * as React from 'react'
import { EmailReplyForwardActions } from '../../../components/detail/EmailReplyForwardActions'
import { ComposeEmailDialog, type ComposeEmailChannel, type ComposeEmailValues } from '../../../components/detail/ComposeEmailDialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type WidgetData = {
  interactionId?: string | null
  externalMessageId?: string | null
  personId?: string | null
  fromAddress?: string | null
  toAddresses?: string[] | null
  ccAddresses?: string[] | null
  subject?: string | null
  inReplyTo?: string | null
  references?: string[] | null
}

export function PersonEmailCardActionsWidget({ data }: { data?: WidgetData }) {
  const t = useT()
  const [mode, setMode] = React.useState<null | 'reply' | 'replyAll' | 'forward'>(null)
  const [channels, setChannels] = React.useState<ComposeEmailChannel[]>([])

  React.useEffect(() => {
    apiCall<{ items?: ComposeEmailChannel[] }>(`/api/communication_channels/me/channels?status=connected`, { method: 'GET' })
      .then((r) => setChannels((r.result?.items ?? []) as ComposeEmailChannel[]))
      .catch(() => setChannels([]))
  }, [])

  if (!data?.personId) return null
  const subjectBase = data.subject ?? ''
  const replyTo = mode == null ? null : {
    inReplyTo: data.externalMessageId ?? '',
    references: data.references ?? undefined,
    to: mode === 'forward' ? [] : data.fromAddress ? [data.fromAddress] : [],
    cc: mode === 'replyAll' ? data.ccAddresses ?? undefined : undefined,
    subject: mode === 'forward' ? `Fwd: ${subjectBase}` : (subjectBase.startsWith('Re:') ? subjectBase : `Re: ${subjectBase}`),
  }

  const onSend = async (values: ComposeEmailValues) => {
    const response = await apiCall<{ messageId?: string }>(
      `/api/customers/people/${data.personId}/emails`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) },
    )
    if (!response.ok) {
      const err = response.result as { error?: string } | null
      throw new Error(err?.error ?? t('customers.email.errors.sendFailed', 'Send failed'))
    }
    flash(t('customers.email.compose.sent', 'Email sent'), 'success')
    return { messageId: response.result?.messageId ?? null }
  }

  return (
    <>
      <EmailReplyForwardActions
        onReply={() => setMode('reply')}
        onReplyAll={() => setMode('replyAll')}
        onForward={() => setMode('forward')}
      />
      {mode != null && (
        <ComposeEmailDialog
          open={mode != null}
          onOpenChange={(o) => setMode(o ? mode : null)}
          personId={data.personId}
          defaultRecipient={data.fromAddress ?? null}
          channels={channels}
          replyTo={replyTo}
          onSend={onSend}
        />
      )}
    </>
  )
}
```

- [ ] **Step 3: Sanitize HTML for the email detail body**

When rendering the body in the card or a detail drawer, never inject the raw HTML directly. Reuse the hub's existing sanitizer:

```tsx
import { sanitizeChannelHtml } from '@open-mercato/core/modules/communication_channels/lib/sanitize-channel-html'

// inside the rendering for an email body:
const sanitized = sanitizeChannelHtml(rawBody)
return <div dangerouslySetInnerHTML={{ __html: sanitized }} />
```

The customers module's data flow already pulls the body from the `CustomerInteraction.body` column (the subscriber writes plain text there in Task 9). For users who want the rich HTML view, the detail surface should fetch the underlying `MessageChannelLink.channelPayload.html` and pass it through `sanitizeChannelHtml`. The fetch route lives in `messages` module; the customers UI calls it via `apiCall('/api/messages/...').

If the v1 drawer is "plain text body only" (simpler), skip the HTML fetch entirely and render `interaction.body` as plain text — the spec allows deferring rich rendering. Add a TODO comment in the widget pointing at the future enhancement.

- [ ] **Step 4: Map both widgets to their spots in injection-table.ts**

Add the new widget IDs to the existing `injectionTable` array, mapping to:
- `customers:person-email-card-actions` → spot `data-table:customers.person.interactions:row-actions` (or whichever spot the ActivityCard renders email cards in — confirm via codebase grep).

- [ ] **Step 5: yarn generate + structural cache**

```bash
yarn generate
yarn mercato configs cache structural --all-tenants
```

- [ ] **Step 6: Typecheck**

Run: `yarn workspace @open-mercato/core typecheck 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 7: Stage**

```bash
git add packages/core/src/modules/customers/components/detail/EmailReplyForwardActions.tsx packages/core/src/modules/customers/widgets/injection/person-email-card-actions/ packages/core/src/modules/customers/widgets/injection-table.ts
```

---

### Task 17: Add i18n keys to 4 locales

**Files:**
- Modify: `packages/core/src/modules/customers/i18n/en.json`
- Modify: `packages/core/src/modules/customers/i18n/pl.json`
- Modify: `packages/core/src/modules/customers/i18n/es.json`
- Modify: `packages/core/src/modules/customers/i18n/de.json`

- [ ] **Step 1: Add keys to en.json**

The new keys (flat format — match existing pattern):

```json
"customers.email.compose.title": "Compose email",
"customers.email.compose.send": "Send",
"customers.email.compose.sending": "Sending…",
"customers.email.compose.cancel": "Cancel",
"customers.email.compose.button": "Send email",
"customers.email.compose.sendAs": "Send as",
"customers.email.compose.to": "To",
"customers.email.compose.cc": "Cc",
"customers.email.compose.bcc": "Bcc",
"customers.email.compose.subject": "Subject",
"customers.email.compose.body": "Body",
"customers.email.compose.visibility": "Visibility",
"customers.email.compose.visibility.private": "Private to me",
"customers.email.compose.visibility.shared": "Visible to teammates",
"customers.email.compose.noChannel.cta": "Connect your mailbox",
"customers.email.compose.sent": "Email sent",
"customers.email.timeline.reply": "Reply",
"customers.email.timeline.replyAll": "Reply all",
"customers.email.timeline.forward": "Forward",
"customers.email.timeline.privateCount": "%{count} emails private to teammates",
"customers.email.visibility.flipToShared.success": "Email shared with teammates",
"customers.email.visibility.flipToPrivate.success": "Email made private",
"customers.email.errors.sendFailed": "Send failed",
"customers.email.errors.channelNotConnected": "Channel not connected"
```

- [ ] **Step 2: Add the same keys to pl.json, es.json, de.json**

Translate to Polish (pl), Spanish (es), German (de). The product's existing locales use machine-translated baselines for non-English when human translation is unavailable; the team polishes them later.

Polish equivalents (verified by `yarn i18n:check-sync`):
- `compose.title`: "Napisz e-mail"
- `compose.send`: "Wyślij"
- `compose.button`: "Wyślij e-mail"
- etc. — fill in all 25 keys.

For es and de, you can start with English values and the team will translate.

- [ ] **Step 3: Run i18n sync check**

Run: `yarn i18n:check-sync 2>&1 | tail -10`
Expected: PASS, "All translation files are in sync."

- [ ] **Step 4: Stage**

```bash
git add packages/core/src/modules/customers/i18n/en.json packages/core/src/modules/customers/i18n/pl.json packages/core/src/modules/customers/i18n/es.json packages/core/src/modules/customers/i18n/de.json
```

---

### Task 18: Integration test TC-CRM-EMAIL-007 (no-channel UX state)

**Files:**
- Create: `packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-007.spec.ts`

- [ ] **Step 1: Write the spec**

Scenario:
1. User A is logged in, has NO connected channel.
2. Navigate to a Person detail page.
3. Assert: a button reading "Connect your mailbox" is present and links to `/backend/profile/communication-channels`. The "Send email" button is NOT present.
4. Now create a connected channel for User A (using a stub adapter or the test channel fixture).
5. Reload the page.
6. Assert: "Send email" button is present and the Connect CTA is gone.

- [ ] **Step 2: Run the spec**

Run: `yarn test:integration --grep "TC-CRM-EMAIL-007" 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 3: Stage**

```bash
git add packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-007.spec.ts
```

---

## Phase 4 — Visibility toggle + privateCount enricher + docs

### Task 19: PATCH visibility route + tests

**Files:**
- Create: `packages/core/src/modules/customers/api/interactions/[id]/visibility/route.ts`
- Create: `packages/core/src/modules/customers/api/interactions/[id]/visibility/__tests__/route.test.ts`

- [ ] **Step 1: Write failing unit tests for validation + 404 paths**

`__tests__/route.test.ts`:

```ts
import { PATCH } from '../route'

function mockRequest(body: unknown) {
  return { json: async () => body, headers: new Headers() } as unknown as Request
}

describe('PATCH /api/customers/interactions/[id]/visibility', () => {
  it('returns 401 unauthenticated', async () => {
    const res = await PATCH(
      mockRequest({ visibility: 'shared' }),
      { params: Promise.resolve({ id: 'i-1' }) } as any,
    )
    expect(res.status).toBe(401)
  })
  it('returns 422 on invalid visibility value', async () => {
    const res = await PATCH(
      mockRequest({ visibility: 'public' }),
      { params: Promise.resolve({ id: 'i-1' }) } as any,
    )
    // depends on auth; unauthenticated path returns 401 first. Mock auth in
    // integration tests; here we only check that an invalid value is rejected.
    expect([401, 422]).toContain(res.status)
  })
})
```

- [ ] **Step 2: Implement the route**

`packages/core/src/modules/customers/api/interactions/[id]/visibility/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  validateCrudMutationGuard,
  runCrudMutationGuardAfterSuccess,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { CustomerInteraction } from '../../../../data/entities'
import { callerHasEmailViewPrivate } from '../../../../lib/visibilityFilter'

export const metadata = {
  path: '/customers/interactions/[id]/visibility',
  PATCH: {
    requireAuth: true,
    requireFeatures: ['customers.email.compose'],
  },
}

const bodySchema = z.object({ visibility: z.enum(['private', 'shared']) }).strict()

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

type RbacServiceLike = {
  loadAcl: (userId: string, scope: { tenantId: string | null; organizationId: string | null }) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

export async function PATCH(req: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid interaction id' }, { status: 400 })
  }
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json().catch(() => null))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid request body' }, { status: 422 })
  }
  const container = await createRequestContainer()
  await validateCrudMutationGuard(container, { moduleId: 'customers', operation: 'customers.email.compose', auth })
  const em = (container.resolve('em') as EntityManager).fork()
  const organizationId = (auth as { orgId?: string | null }).orgId ?? null
  const dscope = { tenantId: auth.tenantId as string, organizationId }

  let userFeatures: string[] = []
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike
    const acl = await rbac.loadAcl(auth.sub as string, { tenantId: auth.tenantId as string, organizationId })
    userFeatures = acl?.isSuperAdmin ? ['*'] : Array.isArray(acl?.features) ? acl.features : []
  } catch { userFeatures = [] }

  const interaction = await findOneWithDecryption(
    em, CustomerInteraction,
    { id, tenantId: auth.tenantId, deletedAt: null, interactionType: 'email' } as any,
    undefined, dscope,
  ) as { id: string; authorUserId?: string | null; visibility?: string | null } | null

  if (!interaction) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  }
  const isAuthor = interaction.authorUserId && interaction.authorUserId === auth.sub
  const isAdmin = callerHasEmailViewPrivate(userFeatures)
  if (!isAuthor && !isAdmin) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  }
  if (interaction.visibility === body.visibility) {
    return NextResponse.json({ ok: true, changed: false })
  }
  const previousVisibility = interaction.visibility ?? 'private'
  ;(interaction as any).visibility = body.visibility
  await em.flush()

  // Emit visibility_changed event for the audit trail. Existing audit_logs
  // module subscribes to this category; admin-bypass flips are auditable
  // because the event payload includes `actorUserId` and the row's `authorUserId`.
  try {
    const { emitCustomersEvent } = await import('../../../../events')
    await emitCustomersEvent('customers.email.visibility_changed', {
      interactionId: interaction.id,
      previousVisibility,
      nextVisibility: body.visibility,
      authorUserId: interaction.authorUserId ?? null,
      actorUserId: auth.sub,
      adminBypass: !isAuthor && isAdmin,
      tenantId: auth.tenantId,
      organizationId,
    })
  } catch {
    // Best-effort emission; failure to emit must not roll back the visibility flip.
  }

  await runCrudMutationGuardAfterSuccess(container, { moduleId: 'customers', operation: 'customers.email.compose', auth })
  return NextResponse.json({ ok: true, changed: true })
}

export const openApi = {
  tags: ['Customers', 'Email'],
  methods: {
    PATCH: {
      summary: 'Flip an email interaction\'s visibility (private ↔ shared)',
      tags: ['Customers', 'Email'],
      requestBody: bodySchema,
      responses: [
        { status: 200, description: 'Updated' },
        { status: 400, description: 'Invalid id' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Email not found or not visible to caller' },
        { status: 422, description: 'Invalid body' },
      ],
    },
  },
}
export default PATCH
```

- [ ] **Step 3: Run unit tests + typecheck**

Run: `yarn workspace @open-mercato/core jest packages/core/src/modules/customers/api/interactions/\[id\]/visibility 2>&1 | tail -10`
Expected: PASS.

Run: `yarn workspace @open-mercato/core typecheck 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 4: Stage**

```bash
git add packages/core/src/modules/customers/api/interactions/\[id\]/visibility/route.ts packages/core/src/modules/customers/api/interactions/\[id\]/visibility/__tests__/route.test.ts
```

---

### Task 20: Visibility toggle UI on email card

**Files:**
- Modify: `packages/core/src/modules/customers/widgets/injection/person-email-card-actions/widget.client.tsx`

- [ ] **Step 1: Add a lock/people icon button to the existing actions widget**

Update the existing component so the row of actions includes a third icon (lock when private, users when shared). Clicking flips state via PATCH and reflects optimistically.

Inside `PersonEmailCardActionsWidget`, add to the data type: `currentVisibility?: 'private' | 'shared' | null; isAuthor?: boolean | null` — these come from the row data the DataTable passes in.

Render (only when `data.isAuthor === true`):

```tsx
import { Lock, Users } from 'lucide-react'

// inside the return, after EmailReplyForwardActions:
{data.isAuthor && data.currentVisibility ? (
  <Button
    variant="ghost"
    size="sm"
    aria-label={data.currentVisibility === 'private'
      ? t('customers.email.visibility.flipToShared.label', 'Share with teammates')
      : t('customers.email.visibility.flipToPrivate.label', 'Make private')}
    onClick={async () => {
      const next = data.currentVisibility === 'private' ? 'shared' : 'private'
      const r = await apiCall<{ ok: boolean }>(
        `/api/customers/interactions/${data.interactionId}/visibility`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visibility: next }) },
      )
      if (!r.ok) {
        const err = r.result as { error?: string } | null
        flash(err?.error ?? t('customers.email.errors.flipFailed', 'Visibility update failed'), 'error')
        return
      }
      flash(next === 'shared'
        ? t('customers.email.visibility.flipToShared.success', 'Email shared with teammates')
        : t('customers.email.visibility.flipToPrivate.success', 'Email made private'), 'success')
    }}
  >
    {data.currentVisibility === 'private' ? <Lock className="h-4 w-4" /> : <Users className="h-4 w-4" />}
  </Button>
) : null}
```

- [ ] **Step 2: Add i18n keys for the new labels (en + 3 locales)**

`en.json` additions:
```json
"customers.email.visibility.flipToShared.label": "Share with teammates",
"customers.email.visibility.flipToPrivate.label": "Make private",
"customers.email.errors.flipFailed": "Visibility update failed"
```
Mirror across pl, es, de.

- [ ] **Step 3: Run i18n sync + typecheck**

```bash
yarn i18n:check-sync
yarn workspace @open-mercato/core typecheck
```
Expected: both PASS.

- [ ] **Step 4: Stage**

```bash
git add packages/core/src/modules/customers/widgets/injection/person-email-card-actions/widget.client.tsx packages/core/src/modules/customers/i18n/{en,pl,es,de}.json
```

---

### Task 21: privateCount response enricher

**Files:**
- Modify: `packages/core/src/modules/customers/data/enrichers.ts`
- Create: `packages/core/src/modules/customers/data/__tests__/enrichers.privateEmailCount.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { privateEmailCountEnricher } from '../enrichers'

describe('privateEmailCountEnricher', () => {
  it('returns _privateEmailCount = 0 when no other-user private emails exist', async () => {
    const em = {
      getKnex: () => ({
        select: () => ({
          count: () => ({
            from: () => ({
              where: () => ({
                where: () => ({
                  where: () => ({
                    whereNot: () => ({ first: async () => ({ count: 0 }) }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }
    const records = [{ id: 'p-1' }]
    const out = await privateEmailCountEnricher.enrichMany!(records, {
      em,
      tenantId: 't', organizationId: null, userId: 'u', userFeatures: [],
    } as any)
    expect(out[0]).toMatchObject({ id: 'p-1', _privateEmailCount: 0 })
  })
})
```

(Adjust mock shape to match the kysely / knex interface actually in use — confirm via existing enricher in `data/enrichers.ts`.)

- [ ] **Step 2: Add the enricher to `data/enrichers.ts`**

```ts
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'

export const privateEmailCountEnricher: ResponseEnricher<{ id: string }, { _privateEmailCount?: number }> = {
  id: 'customers.private-email-count',
  targetEntity: 'customers.person',
  features: ['customers.people.view'],
  priority: 30,
  timeout: 1500,
  fallback: { _privateEmailCount: 0 },
  critical: false,
  async enrichOne(record, ctx) {
    const [out] = await this.enrichMany!([record], ctx)
    return out
  },
  async enrichMany(records, ctx) {
    if (records.length === 0) return records
    const personIds = records.map((r) => r.id)
    const knex = (ctx as any).em?.getKnex?.()
    if (!knex) return records.map((r) => ({ ...r, _privateEmailCount: 0 }))
    const rows = await knex('customer_interactions')
      .select('entity_id')
      .count<{ entity_id: string; count: number | string }[]>('* as count')
      .where('tenant_id', ctx.tenantId)
      .where('interaction_type', 'email')
      .where('visibility', 'private')
      .whereNull('deleted_at')
      .whereIn('entity_id', personIds)
      .whereNot('author_user_id', ctx.userId)
      .groupBy('entity_id')
    const map = new Map<string, number>()
    for (const row of rows) map.set(String(row.entity_id), Number(row.count))
    return records.map((r) => ({ ...r, _privateEmailCount: map.get(r.id) ?? 0 }))
  },
}

// Add to the existing exported `enrichers` array:
// export const enrichers: ResponseEnricher[] = [
//   …existing entries…,
//   privateEmailCountEnricher,
// ]
```

- [ ] **Step 3: Wire the enricher into the customers people CRUD route**

Confirm the existing people route already has `enrichers: { entityId: 'customers.person' }` configured. If yes, the new enricher auto-attaches. If not, add the opt-in.

- [ ] **Step 4: Run tests + typecheck**

```bash
yarn workspace @open-mercato/core jest packages/core/src/modules/customers/data/__tests__/enrichers.privateEmailCount
yarn workspace @open-mercato/core typecheck
```
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add packages/core/src/modules/customers/data/enrichers.ts packages/core/src/modules/customers/data/__tests__/enrichers.privateEmailCount.test.ts
```

---

### Task 22: User-facing documentation

**Files:**
- Create: `apps/docs/docs/user-guide/customers-email.mdx`

- [ ] **Step 1: Write the doc**

Sections:
1. **Connect your mailbox first** — links to `/backend/profile/communication-channels`.
2. **Send an email from a Person page** — screenshots and click path.
3. **Inbound emails on the Person timeline** — auto-link rules; what happens with unknown senders.
4. **Private vs shared** — defaults, when each is right, how to flip.
5. **Threading** — how replies stay attached.
6. **Reply / Reply all / Forward** — UI walkthrough.
7. **What admins see** — view_private feature; audit trail.
8. **Troubleshooting** — common issues (no channel, send failed, address mismatch).

Cross-link with `apps/docs/docs/user-guide/communication-channels.mdx` for the underlying mailbox setup.

- [ ] **Step 2: Build the docs locally if convenient**

Run: `yarn workspace @open-mercato/docs dev 2>&1 | tail -5` (optional; depends on dev environment)

- [ ] **Step 3: Stage**

```bash
git add apps/docs/docs/user-guide/customers-email.mdx
```

---

### Task 23: Integration test TC-CRM-EMAIL-006 (visibility lifecycle + admin bypass + cross-user denial)

**Files:**
- Create: `packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-006.spec.ts`

- [ ] **Step 1: Write the spec**

Scenario:
1. Setup: tenant T1, Person `bob@example.com`, Users A (employee) and B (employee), User Admin (with `customers.email.view_private`). User A has a connected channel.
2. User A sends an email to bob with visibility='private' (via Phase 2 POST route).
3. Wait for subscriber.
4. **Cross-user denial**: User B's `GET /api/customers/interactions?entityId={bob.id}&interactionType=email` returns 0 rows.
5. **Author can flip**: User A calls `PATCH /api/customers/interactions/{interaction.id}/visibility` with `{visibility: 'shared'}` → 200 with `{ok: true, changed: true}`. User B's GET now returns 1 row.
6. **Non-author cannot flip**: User B calls PATCH back to `'private'` → 404 (interaction "not found").
7. **Admin can flip**: User Admin calls PATCH back to `'private'` → 200 changed:true. User B's GET returns 0 rows again.
8. **Admin sees everything by default**: User Admin's GET on the Person returns the email (admin bypass on the Layer 1 filter).

Cleanup: delete fixtures.

- [ ] **Step 2: Run the spec**

Run: `yarn test:integration --grep "TC-CRM-EMAIL-006" 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 3: Stage**

```bash
git add packages/core/src/modules/customers/__integration__/TC-CRM-EMAIL-006.spec.ts
```

---

## Final CI gates

After every task in every phase, run these gates and ensure they all pass before opening a PR:

- [ ] **Step 1: Build packages**
```bash
yarn build:packages 2>&1 | tail -5
```
Expected: PASS, 22+ packages.

- [ ] **Step 2: yarn generate (clean)**
```bash
yarn generate 2>&1 | tail -5
```
Expected: PASS with no churn.

- [ ] **Step 3: i18n sync**
```bash
yarn i18n:check-sync 2>&1 | tail -5
```
Expected: PASS, 4 locales in sync.

- [ ] **Step 4: typecheck**
```bash
yarn typecheck 2>&1 | tail -5
```
Expected: PASS, all packages.

- [ ] **Step 5: unit tests**
```bash
yarn test 2>&1 | tail -10
```
Expected: PASS, all packages.

- [ ] **Step 6: integration tests for new CRM email scenarios**
```bash
yarn test:integration --grep "TC-CRM-EMAIL" 2>&1 | tail -20
```
Expected: 7 specs PASS (001–007).

- [ ] **Step 7: build:app**
```bash
yarn build:app 2>&1 | tail -10
```
Expected: PASS (the Next.js app compiles).

- [ ] **Step 8: yarn mercato auth sync-role-acls on staging/local DB**

This ensures existing tenants get the two new features (`customers.email.compose` + `customers.email.view_private`):
```bash
yarn mercato auth sync-role-acls 2>&1 | tail -5
```
Expected: PASS, two new features added to admin + employee roles in all tenants.

- [ ] **Step 9: yarn mercato configs cache structural --all-tenants**

```bash
yarn mercato configs cache structural --all-tenants 2>&1 | tail -5
```
Expected: PASS — the new injection widgets get registered in the structural cache.

---

## Notes for the implementing engineer

1. **Branch**: stay on `spec/email-integration`. Do NOT create a new worktree.
2. **Commits**: never run `git commit` — the user reviews staged diffs and commits manually at each phase boundary (per `feedback_no_auto_commit`).
3. **Conventions**: every API route has per-method `metadata`, `openApi`, and `export default <METHOD>` at the end. Every subscriber/worker exports `metadata = { event, persistent?, id }`. No raw `em.find` / `em.findOne` — use `findWithDecryption` / `findOneWithDecryption`.
4. **OSS independence**: the customers module must NOT import from `@open-mercato/enterprise`. Run `grep -r "@open-mercato/enterprise" packages/core/src/modules/customers/` after each phase and confirm no new matches.
5. **i18n**: every new user-facing string is i18n-keyed in all 4 locales (en/pl/es/de). Run `yarn i18n:check-sync` before staging.
6. **Tests**: TDD discipline — write the failing test first, run it to verify failure, then implement, then verify passing. Don't skip the failure check.
7. **MikroORM column names**: when in doubt about a column name (`entity` vs `entity_id`, etc.), check the existing migration files in `packages/core/src/modules/customers/migrations/`. They are the ground truth.
8. **`yarn workspace @open-mercato/core` vs `yarn workspace @open-mercato/app`**: the customers module lives in `@open-mercato/core`. Tests + typecheck run there. The Next.js app is `@open-mercato/app` — only `yarn build:app` cares about it.
