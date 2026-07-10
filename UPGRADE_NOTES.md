# Upgrade Notes

Open Mercato `0.5.0` is our biggest release so far. It bundles more than 250 fixes and
improvements that landed after the Hackathon in Sopot, alongside several important
dependency and tooling upgrades. That combination is exactly why this document now exists:
to give downstream app and module authors one place to review the upgrade work that may
require code changes on their side.

This document lists backward-incompatible changes that users of the Open Mercato platform
must apply to their own modules, apps, and extensions when upgrading between framework
versions. It only covers **actionable** incompatibilities — library behavior that affects
code a downstream module author can plausibly write against.

For the platform's own contract-surface stability guarantees, see
[`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md).

For user-facing release highlights see [`CHANGELOG.md`](CHANGELOG.md).

Companion AI skills (one per upgrade window) live in
[`.ai/skills/om-auto-upgrade-<from>-<to>/SKILL.md`](.ai/skills/) and can mechanically migrate
most of the patterns listed below in a user's codebase.

---

## 0.6.5 → 0.6.6 (unreleased)

### Tenant-scoped search settings + verified provider availability (#3092)

Vector/fulltext search settings (Cmd+K strategies, embedding provider/model, auto-index flag) were stored in a single global `module_configs` row, so any tenant admin's save overwrote every tenant's configuration. Settings are now scoped per tenant: a tenant reads/writes only its own row and inherits the instance default (legacy global row) → env-derived default when unset. Four downstream-visible changes:

1. **Search settings are now tenant-scoped.** Settings `GET` responses gain a `source: 'tenant' | 'instance' | 'env'` field indicating where the effective value came from. *Action for downstream:* none for typical callers; clients must not assume one tenant's settings apply to another.

2. **`ModuleConfigService` gained an optional `scope` argument** on `getRecord`/`getValue`/`setValue`/`invalidate`. This is **additive** — every caller that omits `scope` keeps the exact prior behavior (the global row). `ModuleConfigRecord` gained additive `tenantId`/`organizationId`/`source` fields. *Action for downstream:* none; opt into per-tenant config by passing `scope` where you want it.

3. **`module_configs` schema change (additive).** Added nullable `tenant_id`/`organization_id` columns; replaced the single `(module_id, name)` unique constraint with two partial unique indexes (global `WHERE tenant_id IS NULL`, scoped `WHERE tenant_id IS NOT NULL`). Existing rows keep `tenant_id = NULL` and become the instance default; no backfill required. *Action for downstream:* apply the `configs` module migration (`Migration20260617150000`) before relying on tenant-scoped settings.

4. **Provider availability is now verified (behavior fix).** `isProviderConfigured('ollama')` previously returned `true` unconditionally. A new cached, fail-closed `embeddingProviderProbe` (additive DI key) actively checks Ollama via `GET {OLLAMA_BASE_URL}/api/tags` (key-presence for the other providers). The embeddings settings `GET` returns per-provider `available`/`reason`, and the embeddings `POST` rejects selecting an unreachable provider with `409 { error, reason }`. *Action for downstream:* environments that relied on Ollama always reporting "available" must ensure Ollama is actually reachable at `OLLAMA_BASE_URL` (which was already required for embedding to function).

All changes are additive at the contract surface. No event IDs, widget spot IDs, ACL feature IDs, import paths, or CLI commands changed. The vector index (shared pgvector table) remains instance-level; per-tenant scoping covers settings selection, not stored vectors. See [`.ai/specs/2026-06-15-tenant-scoped-search-settings.md`](.ai/specs/2026-06-15-tenant-scoped-search-settings.md) (tracking issue #3092).

### Versioned browser-storage envelopes for shared UI preference slots (#3457)

Several shared UI surfaces that persist client state to `localStorage` — DataTable perspective snapshots, the AppShell sidebar collapsed-groups set, the AI model picker selection, and the AI chat sessions cache — now write through a shared **versioned-envelope** helper (`packages/shared/src/lib/browser/versionedPreference.ts`) instead of bare JSON. On disk each of these slots now carries a `{ v, data }` shape with an explicit version discriminator, rather than the raw value it stored before.

**No manual action is required for end users.** The `localStorage` **keys are unchanged**, and `readVersionedPreference(...)` migrates a pre-envelope (legacy bare) value forward automatically on the next write when a `legacyIsValid` guard is supplied (as it is for every slot migrated in #3457). Stored data that is version-mismatched or malformed is safely discarded back to the documented fallback instead of crashing or silently corrupting UI state, so a downgrade/upgrade across this boundary simply re-derives defaults at worst.

**Action for module authors who read/write these persisted slots directly.** If your module reads or writes one of these shared `localStorage` keys (or adds its own structured preference slot), go through the helper rather than `safeLocalStorage`/raw `localStorage`:

```ts
import {
  readVersionedPreference,
  writeVersionedPreference,
  // readVersionedIdSet / writeVersionedIdSet for the common "set of ids" shape
} from '@open-mercato/shared/lib/browser/versionedPreference'

// read: validate the envelope, discard stale/mismatched data, migrate a legacy bare value forward
const value = readVersionedPreference(key, version, isValid, fallback, { legacyIsValid })
// write: wraps as { v: version, data: value }
writeVersionedPreference(key, version, value)
```

Follow the **versioning threshold** documented in [`packages/shared/AGENTS.md`](packages/shared/AGENTS.md) when deciding whether a slot needs an envelope: trivial scalar flags (a single boolean/number/string with no schema to evolve, e.g. `om:sidebarCollapsed`) MAY stay raw via `safeLocalStorage`; **structured values** (objects, records, arrays of objects whose shape can change incompatibly) MUST use a versioned envelope so a future shape change can migrate or discard old data. A slot that already carries its own inline `{ v, ... }` discriminator is already migratable and MUST NOT be re-wrapped — re-wrapping changes the on-disk format and discards existing user data.

This is a refactor with no API, event-ID, DI, or DB-schema contract change. Related: #3457 (this change), and the sibling persisted-storage audit tracked in #3174 / #3393.

### Selectable dev-mode watch scope (opt-in, default unchanged)

In the monorepo, `yarn dev` can now watch a **subset** of workspace packages instead of always watching every one. The default remains `all` (watch everything), so **no action is required** — existing `yarn dev` / `yarn dev:greenfield` runs behave exactly as before.

To opt in, pick a scope with the new `OM_WATCH_SCOPE` env var or the `--watch=<mode>` flag (CLI flag wins over the env var):

- `all` (default) — watch every package.
- `auto-optimized` — watch only packages your git working tree / current-branch diff touched, re-checking every 2 minutes and expanding to newly-touched packages.
- `popular` — watch only the most frequently changed packages from recent `git log` history (`OM_WATCH_POPULAR_LIMIT`, default 6; falls back to `core`, `ui`, `shared`).
- `env` — watch exactly the packages in `OM_WATCH_PACKAGES`, or the selection saved by the interactive picker (`yarn dev:watch-select`, persisted to the gitignored `.mercato/watch-packages.local.json`).

```bash
yarn dev --watch=auto-optimized
OM_WATCH_SCOPE=env OM_WATCH_PACKAGES=core,ui yarn dev
yarn dev:greenfield --watch=popular
```

Additional knobs: `OM_WATCH_GIT_STATUS`, `OM_WATCH_GIT_BRANCH`, `OM_WATCH_BASE_REF`, `OM_WATCH_POPULAR_LIMIT`. This is purely a local dev-DX feature: no API, event-ID, DI, ACL, or DB-schema contract changed, and the app source is still fully watched by Next.js/Turbopack regardless of scope. Standalone create-app projects do not run the workspace-package watcher in normal use. See [the troubleshooting guide](apps/docs/docs/appendix/troubleshooting.mdx) for the full reference.

### Removed — `MODULE_FACTS_ALLOWLIST` export (module fact-sheet auto-discovery) (#3752, #3798, #3754)

The module fact-sheet generator no longer gates on a hard-coded 9-module allowlist. It now **auto-discovers** every source-available package module: the `create-app` build (and `mercato agentic:init`) bundle a fact-sheet for every package-provided module (`discoverPackageModuleSources`), shipped to scaffolded apps as `.ai/guides/module-facts.json` + per-module sheets. The monorepo no longer emits a committed `apps/mercato/src/module-facts.generated.json` — that artifact had no runtime or test consumer and has been removed along with its generator (`generateModuleFacts`) and the unused registry-driven `discoverEnabledModuleSources` path.

- **Removed (#3754):** `MODULE_FACTS_ALLOWLIST` and `ModuleFactsModuleId` (previously exported from `@open-mercato/cli/lib/generators/module-facts`) are **gone**. Their only remaining runtime consumer was the legacy `core.<module>.md` redirect-stub loop, retired in the same change. Because the whole fact-sheet auto-discovery layer is still `Unreleased` (it never shipped in a tagged release), the exports are removed outright with no deprecation window.
- **Additive, non-breaking API:** `extractModuleFacts` gained an optional `moduleRoot`, and `extractAllModuleFacts` gained an optional `sources`. The legacy `{ coreSrcRoot, moduleIds? }` call shape still works, but with `MODULE_FACTS_ALLOWLIST` gone it no longer falls back to the historical 9-module list — pass an explicit `moduleIds` (or the preferred `sources`) instead.

*Action for downstream:* callers that imported `MODULE_FACTS_ALLOWLIST` to enumerate documented modules must instead read the keys of the bundled `.ai/guides/module-facts.json` (or call `discoverPackageModuleSources` from `@open-mercato/cli/lib/generators/module-facts-discovery`). No tagged release ever exported these names, so no in-the-wild code depends on them. See [`.ai/specs/2026-07-06-module-facts-auto-discovery.md`](.ai/specs/2026-07-06-module-facts-auto-discovery.md).

### Removed — per-module standalone AI guides → generated fact-sheets (#3715, #3754)

The hand-written per-module standalone guides that shipped into scaffolded apps as `.ai/guides/core.<module>.md` (for the user-facing core modules `auth`, `catalog`, `currencies`, `customer_accounts`, `customers`, `data_sync`, `integrations`, `sales`, `workflows`) are replaced by two layers:

- **Generated per-module fact-sheets** — `.ai/guides/modules/<module>.md` plus a combined `.ai/guides/module-facts.json` sidecar, extracted from module source (entities, events, ACL features, API routes with per-method auth, DI service tokens, searchable entities, host extension tokens, notifications, CLI) at build time.
- **One hand-written conceptual guide** — `.ai/guides/module-system.md`, covering the timeless module-system concepts (anatomy, auto-discovery, naming, mandatory mechanisms, data integrity, migrations).

*Action for downstream:* reference `.ai/guides/modules/<module>.md` for a module's concrete facts and `.ai/guides/module-system.md` for conceptual guidance. The legacy `.ai/guides/core.<module>.md` redirect stubs that briefly bridged the old names were **retired outright in #3754**: because they never shipped in a tagged release (the whole layer is still `Unreleased`), they were removed with no deprecation window rather than kept for a minor. Freshly scaffolded apps already link only the new paths. See [`.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md`](.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md).

---

## 0.6.3 → 0.6.4 (2026-06-08)

### Tenant-ownership & per-module ACL authorization hardening (#2612)

Closes a class of Broken Access Control (OWASP A01 / BOLA+BFLA) defects where the platform checked *capability* (route `requireFeatures`) but not *object/target-module ownership* before reading or mutating. Three downstream-visible changes:

1. **Generic entity-records API now enforces the target module's ACL.** `GET/POST/PUT/DELETE /api/entities/records` (and CSV/export) previously authorized with only `entities.records.view` / `entities.records.manage`. They now also require the **owning module's** feature for the requested `entityId` (e.g. `directory.tenants.view` for `directory:tenant`, `customers.people.view` for `customers:customer_person_profile`), resolved from an explicit registry in `packages/core/src/modules/entities/lib/entityAcl.ts`. **Custom/EAV entities are unaffected** — they keep the existing `entities.records.*` + tenant-scope path. **Unmapped ORM-backed entities are fail-closed (super-admin only).** *Action for downstream:* if you exposed a custom **ORM-backed** entity through this generic API, add an entry to the `entityAcl` map (module + view/manage features) or callers without the owning feature will receive `403`.

2. **Public org-slug lookup no longer returns `tenantId`.** `GET /api/directory/organizations/lookup?slug=…` now returns `{ ok, organization: { id, name, slug } }` — the internal `tenantId` field was removed (it was an unauthenticated information leak). The platform-domain customer-portal login/signup flow now resolves the tenant **server-side from `organizationId`** via `resolveTenantContext`. *Action for downstream:* portal clients that read `tenantId` from this response must instead send the org's `id` as `organizationId` to `POST /api/customer_accounts/{login,signup}`. The legacy body `tenantId` is still accepted (with a fail-closed cross-check) for one release, so existing clients keep working during migration. `GET /api/directory/tenants/lookup` is unchanged.

3. **Auth user & role mutations enforce target-tenant ownership.** `PUT`/`DELETE /api/auth/users`, the user ACL/consents/resend-invite routes, and role create/update/delete now verify the **target** user/role belongs to the actor's tenant (and org scope where applicable). A non-super-admin acting on a foreign-tenant or platform (`tenantId = null`) id now receives `404` (cross-tenant/unknown) or `403` (in-tenant, out-of-allowed-org) instead of silently mutating it. Super-admin (incl. selected-tenant) behavior is unchanged. *Action for downstream:* none unless you relied on the cross-tenant bypass; integrators that assumed a tenant admin could edit arbitrary `userId`s will now be denied (this was unintended).

No DB schema change. No ACL feature IDs were renamed or removed (only enforced). See [`.ai/specs/implemented/2026-06-05-tenant-ownership-and-module-acl-authorization.md`](.ai/specs/implemented/2026-06-05-tenant-ownership-and-module-acl-authorization.md). Enterprise `security` (MFA admin/enforcement) variants are tracked separately in [`.ai/specs/enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md`](.ai/specs/enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md).

### Enterprise `security` — MFA admin & enforcement views are now tenant-scoped (#2612)

Same root cause as above, in the enterprise `security` module. Because `security/setup.ts` grants default admins `security.*`, every tenant admin held `security.admin.manage` — which previously let them read/act across **all** tenants. Now enforced (super-admin/platform required for cross-tenant or platform-wide views):

1. **Per-user MFA admin (IDOR closed).** `GET /api/security/users/[id]/mfa/status` and `POST /api/security/users/[id]/mfa/reset` now verify the target user belongs to the actor's tenant — a foreign-tenant target returns `404` even with a valid sudo token (sudo validates the actor, not the target).
2. **MFA compliance.** `GET /api/security/users/mfa/compliance?tenantId=…` no longer prefers a caller-supplied `tenantId`; a non-super-admin requesting a foreign tenant gets `403`.
3. **Enforcement compliance & policies.** `GET /api/security/enforcement/compliance` now requires platform-admin for `scope=platform` (previously it counted users across all tenants) and validates `scope=tenant|organisation` ownership; enforcement policy list/create/update/delete reject foreign-tenant/org scopes for non-super-admins (`403`). The unfiltered `em.find(User, { deletedAt: null })` is unreachable for non-super-admins.

*Action for downstream:* none unless internal tooling relied on a tenant admin viewing other tenants' MFA posture or using `scope=platform` — those calls now require a platform/super-admin. No DB schema change; no ACL feature IDs renamed. Service methods (`MfaAdminService`, `MfaEnforcementService`) gained an **optional** actor-context backstop param — additive, existing callers unaffected. Reuses the core `enforceTenantSelection`/`resolveIsSuperAdmin` helpers, so the enterprise build must be paired with a core that has them (true since ≤ 0.6.4). See [`.ai/specs/enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md`](.ai/specs/enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md).

### New `om-prepare-issue` skill (deferred-work capture)

A new bundled skill, [`om-prepare-issue`](.ai/skills/om-prepare-issue/SKILL.md), codifies the "park this idea for later" workflow. Given a free-form feature brief it (1) researches and writes a spec under `.ai/specs/` to `om-spec-writing` standards, (2) opens a **docs-only spec PR** against `develop` (labels `documentation` + `skip-qa`, reusing `om-auto-create-pr` worktree/branch/label mechanics), and (3) opens a **tracking GitHub issue** that links the spec path and the spec PR and names the implementer skill (`om-implement-spec` / `om-auto-fix-github`) for later pickup. It never implements the feature — the only file it adds is the spec.

The skill is registered in the `automation` tier of [`.ai/skills/tiers.json`](.ai/skills/tiers.json) (alongside `om-auto-create-pr` and `om-auto-fix-github`) and is also shipped into standalone apps scaffolded by `create-mercato-app` (`packages/create-app/agentic/shared/ai/skills/om-prepare-issue/`).

This is purely additive — no existing skill, slash command, API, DB, or module-contract surface changed.

### `om-auto-review-pr` now posts manual-QA instructions on the `needs-qa → qa` transition

[`om-auto-review-pr`](.ai/skills/om-auto-review-pr/SKILL.md) (and `om-review-prs`, which delegates to it) now posts an **additional PR comment with concrete step-by-step manual QA instructions** whenever it routes an approved PR to the `qa` pipeline state (i.e. `needs-qa` present, `skip-qa` absent). The comment uses the house QA route format from `om-auto-qa-scenarios` — P0/P1/P2 priority tags with **Where to click** / **What to verify** / **What can go wrong** blocks derived from the actual diff.

This is additive: the existing claim, pipeline-label, author-handoff, and completion comments are unchanged; the QA-instructions comment is posted only on the `needs-qa → qa` transition (never on `merge-queue`, `changes-requested`, or other states). No action is required from downstream users beyond re-installing skills (below) to pick up the updated `SKILL.md`.

### How to apply these skill changes downstream

Skill content lives in `.ai/skills/<name>/SKILL.md` and is consumed via per-skill symlinks under `.claude/skills/` and `.codex/skills/`. To pick up the new skill and the updated review behavior:

```bash
# List the tier catalog and what is currently installed
yarn install-skills --list

# Re-run the installer to refresh symlinks for your selected tiers.
# om-prepare-issue and om-auto-review-pr both live in the opt-in `automation` tier:
yarn install-skills --with automation      # default tiers + automation
# or install every tier:
yarn install-skills --all
```

The installer is idempotent and tier-driven (`.ai/skills/tiers.json`) — it adds the new symlink and sweeps stale ones; it never edits skill content. Standalone apps generated by `create-mercato-app` receive `om-prepare-issue` automatically the next time agentic setup runs (`yarn mercato agentic:init`).

This is tooling/docs only; no application runtime, API, DB, or module-contract surface changes.

### OSS optimistic locking default-ON (2026-05-27)

The `updated_at`-based optimistic-locking guard introduced in
[`#1981`](https://github.com/open-mercato/open-mercato/pull/2055) is now
**default ON** for every CRUD entity exposed via `makeCrudRoute`. The
runtime behavior is strictly additive — clients that do not send the
`x-om-ext-optimistic-lock-expected-updated-at` header continue to pass
through unchanged — but downstream operators and module authors should
review the following before deploying:

#### What changed

- `parseOptimisticLockEnv(undefined | '' | '   ')` now returns
  `{ mode: 'all' }` (previously `{ mode: 'off' }`). The platform DI
  bootstrap registers a default `crudMutationGuardService` that consults
  the global reader store, which the CRUD factory's
  `registerOptimisticLockReaderIfAbsent` populates at module-load time.
- `OM_OPTIMISTIC_LOCK=off` (case-insensitive; also `false` / `0` /
  `no` / `disabled` / `none`) now disables the guard explicitly.
  Allow-list values (`OM_OPTIMISTIC_LOCK=customers.company,sales.order`)
  continue to work; they narrow coverage to the listed `resourceKind`s.
- `packages/core/src/modules/customers/di.ts` and
  `packages/core/src/modules/sales/di.ts` no longer register their own
  `crudMutationGuardService` — the platform default suffices. They keep
  the hand-wired `registerOptimisticLockReaders(...)` call (companies/
  people use a `kind` discriminator on the polymorphic
  `customer_entities` table, so the generic reader cannot match).

#### When you might see a change in behavior

Only when *all four* of these are true:

1. Your deployment has not set `OM_OPTIMISTIC_LOCK` explicitly.
2. A page issues `PUT` / `PATCH` / `DELETE` with the optimistic-lock
   header set (via `CrudForm` with `optimisticLockUpdatedAt`, or by
   calling `buildOptimisticLockHeader(...)` directly).
3. The header's timestamp does not match the row's current `updated_at`.
4. The route is registered through `makeCrudRoute` (i.e. it picks up
   the auto-registered generic reader).

In that case the mutation now responds with `409` and the structured
body `{ error: 'record_modified', code: 'optimistic_lock_conflict',
currentUpdatedAt, expectedUpdatedAt }` instead of silently winning the
race. Pages built on `CrudForm` already render the localized
`ui.forms.flash.recordModified` flash; custom callers should pin against
`code: 'optimistic_lock_conflict'` (via `extractOptimisticLockConflict`).

#### How to opt out

Set the env var explicitly:

```bash
OM_OPTIMISTIC_LOCK=off
```

Restart the app/dev server — the env is read once at module-load time.

#### Custom modules that registered their own `crudMutationGuardService`

If you wrote a custom module that registers `crudMutationGuardService`
in its `di.ts`, your registration still wins (Awilix replaces same-key
registrations, and module DI runs after the platform default in
`createRequestContainer`). No changes required.

#### Custom modules that built on the old `parseOptimisticLockEnv` default

If your code branches on `parseOptimisticLockEnv(undefined).mode === 'off'`
to short-circuit, that branch now returns `'all'`. Audit any
`if (config.mode === 'off')` paths that fed off the parser default; the
guard's own runtime check (`config.mode === 'off' → PASS`) is unchanged
and still does the right thing.

### Deprecations

#### `GET /api/customers/assignable-staff` → `GET /api/staff/team-members/assignable`

The customer-flow assignable-staff endpoint now lives in the staff module under its canonical URL `/api/staff/team-members/assignable`. The legacy URL `/api/customers/assignable-staff` still works but returns `308 Permanent Redirect` to the new URL with the original query string preserved. RBAC is unchanged (`customers.roles.view` page guard + `customers.roles.manage`/`customers.activities.manage` handler check) so existing role assignments keep working.

```ts
// before
const data = await readApiResultOrThrow('/api/customers/assignable-staff?pageSize=20')

// after
const data = await readApiResultOrThrow('/api/staff/team-members/assignable?pageSize=20')
```

The legacy URL will stay around for at least one minor version and be removed no earlier than the next major release. Update in-tree consumers now; external HTTP clients that follow `308` redirects do not need changes.

See [`.ai/specs/implemented/2026-05-08-staff-decouple-from-core.md`](.ai/specs/implemented/2026-05-08-staff-decouple-from-core.md) for the full migration plan.

### AI coding skills renamed with the `om-` prefix

Every bundled AI coding skill is now namespaced with an `om-` prefix, both under the repo's `.ai/skills/` directory and in the standalone-app scaffolding generated by `create-mercato-app` (`packages/create-app/agentic/shared/ai/skills/`). This avoids collisions with skills a downstream team adds to their own project and matches the `@open-mercato/*` package naming convention.

The rename is purely mechanical — **prepend `om-` to the skill folder name and its `name:` frontmatter**. Skill content and triggers are unchanged. Affected skills:

```
auto-continue-pr            → om-auto-continue-pr
auto-continue-pr-loop       → om-auto-continue-pr-loop
auto-create-pr              → om-auto-create-pr
auto-create-pr-loop         → om-auto-create-pr-loop
auto-fix-github             → om-auto-fix-github
auto-qa-scenarios           → om-auto-qa-scenarios
auto-review-pr              → om-auto-review-pr
auto-sec-report             → om-auto-sec-report
auto-sec-report-pr          → om-auto-sec-report-pr
auto-update-changelog       → om-auto-update-changelog
auto-upgrade-0.4.10-to-0.5.0 → om-auto-upgrade-0.4.10-to-0.5.0
backend-ui-design           → om-backend-ui-design
check-and-commit            → om-check-and-commit
code-review                 → om-code-review
create-agents-md            → om-create-agents-md
create-ai-agent             → om-create-ai-agent
dev-container-maintenance   → om-dev-container-maintenance
ds-guardian                 → om-ds-guardian
fix                         → om-fix
fix-specs                   → om-fix-specs
implement-spec              → om-implement-spec
integration-builder         → om-integration-builder
integration-tests           → om-integration-tests
merge-buddy                 → om-merge-buddy
migrate-mikro-orm           → om-migrate-mikro-orm
open-pr                     → om-open-pr
pre-implement-spec          → om-pre-implement-spec
review-prs                  → om-review-prs
root-cause                  → om-root-cause
skill-creator               → om-skill-creator
smart-test                  → om-smart-test
spec-writing                → om-spec-writing
sync-merged-pr-issues       → om-sync-merged-pr-issues
verify-in-repo              → om-verify-in-repo
```

The create-app scaffolding also ships these standalone-only skills under the same prefix: `om-data-model-design`, `om-eject-and-customize`, `om-module-scaffold`, `om-system-extension`, `om-trim-unused-modules`, `om-troubleshooter`.

What you need to do:

- **Slash-command invocations** change accordingly, e.g. `/auto-create-pr` → `/om-auto-create-pr`, `claude "/module-scaffold"` → `claude "/om-module-scaffold"`.
- **Scripts, docs, or AGENTS.md files** that reference a skill by name or by `.ai/skills/<name>/SKILL.md` path must adopt the `om-` prefix. A one-shot rewrite over your own tree:

  ```bash
  # Update .ai/skills/<name> path references to the om- prefix (review the diff before committing)
  grep -rlE '\.ai/skills/(auto-|backend-ui-design|check-and-commit|code-review|create-|dev-container|ds-guardian|fix|implement-spec|integration-|merge-buddy|migrate-mikro-orm|open-pr|pre-implement-spec|review-prs|root-cause|skill-creator|smart-test|spec-writing|sync-merged-pr-issues|verify-in-repo)' . \
    | xargs sed -i -E 's#(\.ai/skills/)(auto-|backend-ui-design|check-and-commit|code-review|create-|dev-container|ds-guardian|fix|implement-spec|integration-|merge-buddy|migrate-mikro-orm|open-pr|pre-implement-spec|review-prs|root-cause|skill-creator|smart-test|spec-writing|sync-merged-pr-issues|verify-in-repo)#\1om-\2#g'
  ```

- **Custom skills you authored** are unaffected — only the bundled Open Mercato skills moved.

This is tooling/docs only; no application runtime, API, DB, or module-contract surface changes.

---

## 0.6.1 → 0.6.2 (2026-05-19)

No actionable dependency upgrades for downstream user code. See
[`CHANGELOG.md`](CHANGELOG.md) for release highlights.

---

## 0.6.0 → 0.6.1 (2026-05-13)

No actionable dependency upgrades for downstream user code. See
[`CHANGELOG.md`](CHANGELOG.md) for release highlights.

---

## 0.5.0 → 0.6.0 (2026-05-06)

This window carries the MikroORM v6 → v7 migration
([#1513](https://github.com/open-mercato/open-mercato/pull/1513)), the last of the three
majors that were deferred out of the 0.5.0 consolidation. No other dependency majors
shipped in this window.

### Breaking dependency changes that may affect user code

#### `@mikro-orm/*` `^6.6.10` → `^7.0.10`

v7 is ESM-only, dropped Knex for [Kysely](https://github.com/kysely-org/kysely), moved
decorators out of `@mikro-orm/core`, and removed the default `ReflectMetadataProvider`.
Every downstream module with entities, raw SQL, or a standalone ORM bootstrap needs
changes. The full mechanical recipe (incl. tests/Jest setup) lives in the companion skill
[`.ai/skills/om-migrate-mikro-orm/SKILL.md`](.ai/skills/om-migrate-mikro-orm/SKILL.md); the
highlights are:

Decorators moved — import decorators from `@mikro-orm/decorators/legacy`; keep
`OptionalProps`, `Collection`, `EntityManager`, `FilterQuery`, `RequiredEntityData`, etc.
on `@mikro-orm/core`:

```ts
// before
import { Entity, PrimaryKey, Property, ManyToOne, OptionalProps } from '@mikro-orm/core'

// after
import { OptionalProps } from '@mikro-orm/core'
import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
```

`persistAndFlush` / `removeAndFlush` removed — chain instead:

```ts
// before
await em.persistAndFlush(entity)
await em.removeAndFlush(entity)

// after
await em.persist(entity).flush()
await em.remove(entity).flush()
```

Jest mocks must be updated accordingly (`persist: jest.fn().mockReturnThis(), flush: jest.fn()`).

Knex → Kysely — `em.getConnection().getKnex()` is gone; use `em.getKysely<any>()` and the
Kysely query builder. Operators are mandatory (`.where('col', '=', val)`), JSONB needs
`` sql`${JSON.stringify(doc)}::jsonb` ``, `knex.fn.now()` becomes `` sql`now()` ``, and
aggregate results come back as strings (wrap `count()` rows in `Number(...)`). Upserts use
`.onConflict(oc => oc.columns([...]).doUpdateSet({...}))`.

Migrator API renamed — `orm.getMigrator()` → `orm.migrator`,
`migrator.createMigration()` → `migrator.create()`,
`migrator.getPendingMigrations()` → `migrator.getPending()`.

ORM bootstrap (if you call `MikroORM.init` yourself) — register the metadata provider
explicitly, pass `EntityManager` as a generic, and reshape the pool config:

```ts
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { PostgreSqlDriver, EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'

await MikroORM.init<PostgreSqlDriver, PostgreSqlEntityManager<PostgreSqlDriver>>({
  driver: PostgreSqlDriver,
  metadataProvider: ReflectMetadataProvider, // v7 no longer installs this by default
  pool: { min, max, idleTimeoutMillis },     // acquireTimeoutMillis / destroyTimeoutMillis removed
  driverOptions: { connectionTimeoutMillis, ssl },
  entities,
})
```

Without `ReflectMetadataProvider` the legacy decorators silently emit wrong column
metadata at runtime.

Stricter typing — v7 tightens `FilterQuery<T>` / `RequiredEntityData<T>`. Expect to add
occasional casts, wrap ambiguous generic filters with `NoInfer<T>`, and watch out for
`em.create(Entity, { ...spread, override })`: v7's inference exposes cases where a
trailing spread silently overwrites computed fields — put the spread first.

Jest / ESM — v7 uses `import.meta.resolve`, which `ts-jest` on CJS can't run. The repo
ships [`scripts/jest-mikroorm-transformer.cjs`](scripts/jest-mikroorm-transformer.cjs);
wire it in every standalone `jest.config.cjs` and bump `tsconfig` `target` to `ES2022`:

```js
transform: { '^.+\\.(t|j)sx?$': '<rootDir>/../../scripts/jest-mikroorm-transformer.cjs' },
transformIgnorePatterns: ['node_modules/(?!(@mikro-orm)/)'],
```

---

## 0.4.10 → 0.5.0 (2026-04-21)

Release context:
- Biggest Open Mercato release so far
- More than 250 fixes and improvements delivered after the Hackathon in Sopot
- Includes several major dependency upgrades, which is why `UPGRADE_NOTES.md` was added
  for this release window

This window bundles the consolidated Dependabot dependency bumps from
[#1620](https://github.com/open-mercato/open-mercato/pull/1620) (minor/patch) and
[#1621](https://github.com/open-mercato/open-mercato/pull/1621) (major), migrated to
`develop` in [#1625](https://github.com/open-mercato/open-mercato/pull/1625).

Three major bumps with deep platform surface impact were **deliberately reverted** and are
**NOT** part of 0.5.0 — they remain on their 0.4.10 versions and are tracked as separate
dedicated upgrades. See [Deferred majors](#deferred-majors) below.

Companion skill: [`om-auto-upgrade-0.4.10-to-0.5.0`](.ai/skills/om-auto-upgrade-0.4.10-to-0.5.0/SKILL.md).

### Breaking dependency changes that may affect user code

#### `meilisearch` `^0.55` → `^1.0`

The exported client class was renamed from `MeiliSearch` to `Meilisearch` (lowercase `s`),
and the package switched to pure ESM (`"type": "module"`).

Code changes:

```ts
// before
import { MeiliSearch } from 'meilisearch'
const client = new MeiliSearch({ host, apiKey })

// after
import { Meilisearch } from 'meilisearch'
const client = new Meilisearch({ host, apiKey })
```

Jest configuration (ESM): Jest's default `transformIgnorePatterns` skips `node_modules`.
Since `meilisearch@1` ships pure ESM, add an allow-list so `ts-jest`/`babel-jest` can
transform it:

```js
// apps/<your-app>/jest.config.cjs
module.exports = {
  // ...
  transformIgnorePatterns: [
    '/node_modules/(?!meilisearch)/',
    '\\.pnp\\.[^\\/]+$',
  ],
}
```

#### `stripe` `^17` → `^22`

The `Stripe.LatestApiVersion` namespace constant was removed and the zero-argument
`stripe.accounts.retrieve()` was replaced by `stripe.accounts.retrieveCurrent()`.

Code changes:

```ts
// before
import Stripe from 'stripe'
const stripe = new Stripe(apiKey, {
  apiVersion: apiVersion as Stripe.LatestApiVersion,
})
const account = await stripe.accounts.retrieve()

// after
import Stripe from 'stripe'
type StripeConfig = NonNullable<ConstructorParameters<typeof Stripe>[1]>
const stripe = new Stripe(apiKey, {
  apiVersion: apiVersion as StripeConfig['apiVersion'],
})
const account = await stripe.accounts.retrieveCurrent()
```

Also bumped in lock-step: `@stripe/react-stripe-js` `^3` → `^6`, `@stripe/stripe-js`
`^7` → `^9`. Consult Stripe's own migration guides for component-level API changes.

#### `lucide-react` `^0.556` → `^1.8`

Brand icons `Linkedin` and `Twitter` were removed for trademark reasons. Replace with
a semantic substitute (the platform uses `Briefcase` for LinkedIn-style links and
`AtSign` for Twitter-style handles):

```tsx
// before
import { Linkedin, Twitter } from 'lucide-react'

// after
import { Briefcase, AtSign } from 'lucide-react'
```

Other lucide icon name stabilizations landed in the v1 cut — check your imports
against https://lucide.dev/icons if you see "module has no exported member" errors.

Server-side navigation metadata:

If you store page, sidebar, or settings-navigation icons in backend metadata that is
serialized on the server, do **not** pass Lucide component references or JSX elements such
as `icon: Users` or `icon: <Users />`. After the v1 upgrade these can cross the
server/client boundary and break routes such as `/api/auth/admin/nav`.

Use one of these patterns instead:

```ts
// preferred for backend/page metadata
icon: 'users'
```

```ts
// also safe when you need a custom shape
const usersIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
  React.createElement('circle', { cx: 9, cy: 7, r: 4 }),
)

icon: usersIcon
```

If your admin navigation starts failing with an error about calling
`node_modules/lucide-react/dist/esm/Icon.js` from the server, audit every metadata-driven
icon in that nav path and replace component references with icon names or inline SVG.

#### `react-markdown` `^9` → `^10`

The `className` prop was removed from `<ReactMarkdown>`. Wrap the invocation in a
`<div>` that carries the class instead:

```tsx
// before
<ReactMarkdown className="prose" remarkPlugins={plugins}>{body}</ReactMarkdown>

// after
<div className="prose">
  <ReactMarkdown remarkPlugins={plugins}>{body}</ReactMarkdown>
</div>
```

#### `cron-parser` `^4` → `^5`

The default-export factory was removed. `parseExpression` is no longer a function exposed
on the default import — use the named `CronExpressionParser.parse` static method:

```ts
// before
import parser from 'cron-parser'
const expr = parser.parseExpression('*/5 * * * *')

// after
import { CronExpressionParser } from 'cron-parser'
const expr = CronExpressionParser.parse('*/5 * * * *')
```

The returned iterator shape (`next()`, `prev()`, `hasNext()`, `hasPrev()`) is unchanged.

#### `@simplewebauthn/server` `^11` → `^13` (and `@simplewebauthn/types` `^11` → `^12`)

Function signatures were narrowed from `Uint8Array` to `Uint8Array<ArrayBuffer>`. A
`TextEncoder().encode(...)` result or a `new Uint8Array(Buffer.from(...))` result is
typed `Uint8Array<ArrayBufferLike>` and is no longer assignable. Coerce with `.slice()`:

```ts
// before
function toWebAuthnUserId(userId: string): Uint8Array {
  return new TextEncoder().encode(userId)
}
function base64UrlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

// after
function toWebAuthnUserId(userId: string) {
  return new TextEncoder().encode(userId).slice()
}
function base64UrlToBytes(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64url')).slice()
}
```

Several exported types also moved from `@simplewebauthn/types@11` to `@simplewebauthn/types@12`.
If you imported passkey types directly, re-run `tsc` — the message is usually the rename is
transparent once the new version is installed.

#### `recharts` `^2` → `^3`

recharts 3 dropped several default props (e.g. `isAnimationActive`) and tightened the
`ResponsiveContainer` width/height typing. If you render charts in a custom module, expect
to audit any non-default props, particularly custom `Tooltip`/`Legend` content renderers,
which now receive slightly different payload shapes. No helper is provided here — review
https://recharts.org upgrade notes.

#### `rate-limiter-flexible` `^9` → `^11`

Two back-to-back major releases. The constructor options object is mostly compatible; the
main breakage is around the deprecated `pointsConsumed` return field and the strictened
Redis client option type (`useRedisPackage`/`storeClient` unioning). Audit any direct
consumers — the platform itself uses this transitively; user modules that wire their own
`RateLimiterRedis` instance are the ones to watch.

#### `framer-motion` `^11` → `^12`

Most `motion.<el>` call sites continue to work. The layout animation engine was rewritten
and some auto-animated layout transitions now behave slightly differently at the pixel
level. Bug-for-bug parity is not guaranteed; verify any long-running, scroll-triggered, or
gesture-driven animations after upgrading.

#### `glob` `^11` → `^13`

Node 20+ now required. The `Glob` class `matchBase` option was renamed to `matchBases`; the
function signature already accepted `signal` and `withFileTypes`. If you used the
`globSync()` one-shot helper, no code change is needed.

#### `esbuild` `^0.25` → `^0.28`

Only affects build tooling in workspace packages that ship a standalone bundle
(`packages/create-app`, `packages/cli`, `packages/checkout`, `packages/scheduler`,
`packages/webhooks`, `packages/sync-akeneo`). The 0.25→0.28 window made `--outdir` with a
non-existent directory error (previously it silently created it); ensure your build scripts
`mkdir -p` explicitly. No runtime behavior change.

#### `eslint` `^9` → `^10`

Flat config is now the only config format (`.eslintrc.*` is removed). If you still ship a
legacy `.eslintrc.js` in a user module, migrate it to `eslint.config.mjs`. ESLint 10 also
drops Node 18 support — make sure your CI runs Node 20+ at minimum.

#### `rimraf` `^5` → `^6`

Pure tooling change. The default-exported function is now async-only and no longer accepts
the legacy callback signature. If you invoke `rimraf` from a build script, `await` it.

#### `@docusaurus/*` `^3.9` → `^3.10`

Minor bump. No user code changes. The consolidation pins `webpack` to `5.104.1` via
root-level `resolutions` because `webpackbar@6.0.1` (a transitive of `@docusaurus/core@3.10`)
is incompatible with webpack `5.106.x`'s stricter `ProgressPlugin` schema. The pin can be
dropped once `webpackbar` ships a fix or Docusaurus bumps it.

#### AI SDK family

`@ai-sdk/amazon-bedrock` `^4.0.8` → `^4.0.96`, `@ai-sdk/anthropic` `^3.0.12` → `^3.0.71`,
`@ai-sdk/cohere` `^3.0.4` → `^3.0.30`, `@ai-sdk/google` `^2` → `^3`, `@ai-sdk/mistral`
`^3.0.5` → `^3.0.30`, `@ai-sdk/openai` `^3.0.5` → `^3.0.53`, `ai` `^6.0.0` → `^6.0.168`,
`ai-sdk-ollama` `3.0.0` → `3.8.3`.

`@ai-sdk/google` is the only major bump here. v3 renamed the default model factory export
and tightened the tool-call result shape; if you import `google` directly and call `.tool()`
or pass a custom fetch, verify against v3 release notes.

#### Miscellaneous smaller bumps (no known user-code impact)

- `next` `16.2.3` → `16.2.4`, `react`/`react-dom` `19.2.1` → `19.2.5`.
- `@tanstack/react-query` `^5.90.12` → `^5.99.2`.
- `@types/node` `^20`/`^24` → `^25`, `@types/react` `^19.2.7` → `^19.2.14`.
- `newrelic` `^13.16` → `^13.19`, `dotenv` `^17.2.3` → `^17.4.2`, `resend` `^6.5.2` → `^6.12.0`.
- `@tailwindcss/postcss` and `tailwindcss` `^4.1.17` → `^4.2.2`, `tailwind-merge` `^3.4.0` → `^3.5.0`.
- `better-sqlite3` `^12.5` → `^12.9`, `bullmq` `^5.34` → `^5.75`, `ioredis` `^5.8` → `^5.10`.
- `zod` `^4.1.13` → `^4.3.6`, `semver` `^7.7.3` → `^7.7.4`, `testcontainers` `^11.12` → `^11.14`.
- `jest` `^30.2` → `^30.3`, `jest-environment-jsdom` `^30.2` → `^30.3`, `ts-jest` `^29.4.6` → `^29.4.9`.
- `eslint-config-next` `16.1.7` → `16.2.4`.
- `@react-email/components` `^1.0.1` → `^1.0.12`, `react-email` `^5.2.10` → `^6.0.0`.
  react-email v6 changed the CLI entry from `email` to `react-email`; if you scripted the
  CLI, update the command name.
- `@uiw/react-markdown-preview` `^5.1.5` → `^5.2.0`, `@uiw/react-md-editor` `^4.0.11` → `^4.1.0`.
- `openid-client` `^6.3.3` → `^6.8.3`, `otpauth` `9.4.1` → `9.5.0`.
- `@modelcontextprotocol/sdk` `^1.26` → `^1.29`.

### Deferred majors

These majors were bumped by Dependabot but **reverted** before merging because their
migration cost crosses the platform's contract surface. They are not part of 0.5.0 and
are tracked as follow-up work:

| Package | Current pin | Dependabot proposed | Why deferred |
|---------|-------------|---------------------|--------------|
| `@mikro-orm/*` | `^6.6.10` | `^7.0.11` | v7 drops decorator re-exports and `persistAndFlush`/`removeAndFlush`, requires invasive migration across every `data/entities.ts` and all write paths — **addressed in the [0.5.0 → 0.5.1](#050--051-unreleased) window** |
| `typescript` | `^5.9.3` | `^6.0.3` | v6 deprecates `moduleResolution=node10` (`error TS5107`) across every package `tsconfig.json`; fix requires either `"ignoreDeprecations": "6.0"` everywhere or a real migration to `bundler`/`node16` |
| `awilix` | `^12.0.5` | `^13.0.3` | v13 changed the `Cradle` generic default from `any` to `{}`, which makes every `container.resolve('em')` return `unknown` at 100+ DI call sites with no code change |

When a dedicated spec and migration PR land for one of these, it will be listed in its own
`0.x.y → 0.x.(y+1)` window in this document and the corresponding `auto-upgrade-...` skill
will cover it.

---

## Template for future entries

```md
## X.Y.Z → X.Y.(Z+1) (unreleased)

Companion skill: [`om-auto-upgrade-X.Y.Z-to-X.Y.(Z+1)`](.ai/skills/om-auto-upgrade-X.Y.Z-to-X.Y.(Z+1)/SKILL.md).

### Breaking dependency changes that may affect user code

#### `<package>` `^<from>` → `^<to>`

<one paragraph describing the breakage>

```ts
// before
<...>

// after
<...>
```
```

When opening a PR that bumps a dependency across a major boundary, add an entry here in
the same PR. The `auto-upgrade-...` skill for the window picks up entries from this file;
keep the headings stable (exactly `#### \`<package>\` \`^<from>\` → \`^<to>\``) so the
skill can parse them.
