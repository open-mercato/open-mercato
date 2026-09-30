# Migrating the `forms` Module Into `@open-mercato/core`

**Date:** 2026-09-30
**Status:** In progress
**Scope:** OSS — `packages/core`, `apps/mercato`, `packages/ui`
**Author:** Open Mercato Team
**Source:** `open-mercato/official-modules@d694a75`, `packages/forms/src/modules/forms` (branch `develop`)
**Related:** [`.ai/docs/official-modules.md`](../docs/official-modules.md), [`2026-03-20-official-modules-platform-sync-playbook.md`](./2026-03-20-official-modules-platform-sync-playbook.md), [`implemented/SPEC-064-2026-03-14-official-modules-platform-versioning-policy.md`](./implemented/SPEC-064-2026-03-14-official-modules-platform-versioning-policy.md), [`.ai/runs/2026-09-30-forms-module-into-core/PLAN.md`](../runs/2026-09-30-forms-module-into-core/PLAN.md)

## TLDR

**Key Points:**
- The `forms` module moves from the external `official-modules` repository into
  `packages/core/src/modules/forms/` and becomes a first-class core module.
- The migration is **behaviour-preserving**. Every source change is either (a) required by a
  contract this repo enforces and the standalone package did not, or (b) a defect one of this
  repo's gates exposed.
- Only three production dependencies were missing from this monorepo: `ajv`, `ajv-formats`,
  `pdf-lib`. Everything else the module needs already existed.
- Four classes of breakage showed up, each with a single root cause: a `@tanstack/react-table`
  major, an undeclared set of injection hosts, eleven absent i18n keys, and a stale committed
  lucide icon registry.

**Scope:**
- vendoring the module and enabling it in the app module registry
- reconciling it with this repo's auto-discovery, build, test, i18n and extension-point contracts
- integration coverage, browser QA and a code review of a surface that has never seen either here

**Out Of Scope:**
- removing `packages/forms` from `official-modules` (different repository, different PR)
- redesigning or extending the feature — the module's own design specs stay in the source repo
- migrating any other official module

## Problem Statement

`forms` is an audit-grade questionnaire primitive: versioned form definitions, append-only
submissions, role-sliced rendering, a drag-and-drop studio, anonymous public runners, cross-origin
embedding, invitation distribution, PDF snapshots, retention and anonymisation. It is ~301 files and
~59k lines — larger than most core modules and substantially more exposed, because it deliberately
serves unauthenticated users.

Living in `official-modules` costs it three things:

1. **A weaker gate.** The standalone package ran its own `tsc` and `jest` and nothing else. It never
   saw this repo's i18n sync/usage checks, its module-facts extension-point guards, its committed
   icon registry, its DS lint, or its integration harness. Section
   [Defects the migration exposed](#defects-the-migration-exposed) is the direct consequence.
2. **A version lag.** The package pinned published `@open-mercato/* 0.6.3-develop` snapshots while
   core moved to `0.8.0`. Drift accumulated silently until someone tried to build it against the
   current platform.
3. **Optional-ness.** Consuming it requires the `external/official-modules` submodule plus an
   `official-modules.json` activation. A primitive this central should not be behind that.

## Goals

- `forms` builds, typechecks, tests, lints and runs as part of `@open-mercato/core`.
- `yarn generate` discovers every surface it presents with no bespoke wiring.
- The full CI-mirroring gate in `.ai/agentic.config.json` passes.
- Integration coverage exists for its API and key UI paths, per `.ai/qa/AGENTS.md`.
- Its anonymous surface has been security-reviewed against this repo's rules.
- Nothing already in the monorepo changes behaviour.

## Non-Goals

- Refactoring the module's internals, even where this repo would have built it differently. Those
  observations belong in follow-up issues, not in a migration PR.
- Changing its public API shape. The module is new *here*, so nothing in this repo depends on it
  yet, but the source repo's consumers do.

## Design

### Placement

`packages/core/src/modules/forms/`, not a new `packages/forms` workspace.

The module's dependency surface decides this. It already imports
`@open-mercato/core/modules/customer_accounts/lib/customerAuth`,
`@open-mercato/core/modules/attachments/lib/{storage,imageUrls,imageSafety}`,
`@open-mercato/core/modules/attachments/data/entities`,
`@open-mercato/core/modules/directory/utils/organizationScope` and `@open-mercato/core/bootstrap`.
As a sibling package those become cross-package imports needing explicit `exports` entries and a
build-order edge; inside core they are ordinary intra-package imports, which is exactly what 2289
other files in `packages/core/src` already do.

### What made the module portable

Two properties made this a copy rather than a rewrite:

1. **It barely self-references.** The whole tree contained two occurrences of
   `@open-mercato/forms`, both in doc comments. There was no internal import to rewrite.
2. **Core's `exports` map already has deep wildcards** (`./*/*/*`, ten levels). No `package.json`
   `exports` entry was needed for the new tree; the explicit `./modules/customers` /
   `./modules/sales` entries are a convenience for barrel imports, not a requirement.

### Auto-discovery

`apps/mercato/src/modules.ts` is the explicit enable list, so the module needed one entry:

```ts
{ id: 'forms', from: '@open-mercato/core' },
```

placed after `customer_accounts` and `portal`, which its portal pages and public runner resolve auth
through. With that line `yarn generate` produces, with no further wiring:
`api-route-shard.026.forms`, `backend-route-shard.028.forms`, frontend routes, entities, entity ids,
DI registrars, events, command loaders, all five i18n locale bundles, translatable-field
registration and injection widgets.

### New production dependencies

| Package | Version | Used by | Why it cannot be avoided |
|---------|---------|---------|--------------------------|
| `ajv` | `^8.17.1` | `services/form-version-compiler.ts`, `schema/jsonschema-extensions.ts` | Form versions compile to JSON Schema; Ajv is the validator |
| `ajv-formats` | `^3.0.1` | same | `email` / `uri` / `date` format assertions on answers |
| `pdf-lib` | `^1.17.1` | `services/pdf-snapshot-service.ts`, `subscribers/forms-pdf-snapshot.ts` | Renders the immutable submission PDF snapshot |

Core already carries `pdfjs-dist`, but that reads PDFs; `pdf-lib` writes them. Root `AGENTS.md`
requires asking before adding production dependencies. These three are intrinsic to the module
being migrated, so the alternative is not migrating it; they are called out here rather than
treated as incidental.

## Defects the migration exposed

Each of these was latent in the source repo and surfaced the moment a gate this repo runs looked at
the module. They are listed with the gate that caught them, because that is the useful part.

### 1. `@tanstack/react-table` v8 → v9 (`yarn typecheck`, 28 errors)

The module was written against v8, where `ColumnDef` took 1–2 type arguments. This repo is on v9,
where it takes 2–3 and the v8 shape moved behind `LegacyColumnDef` in
`@tanstack/react-table/legacy`. Every other core DataTable page here already imports the legacy
alias; four forms files did not. Switching the import cleared all 28 errors without touching a
single column definition.

### 2. Undeclared injection hosts (`yarn test`, fatal in `@open-mercato/cli`)

`widgets/injection-table.ts` mapped five widgets onto spot ids — four `submission-drawer:*` and one
`forms:embed` — that the module never declared. This repo resolves first-party injection targets
through a module's `extension-points.ts` convention file, and `assertNoUnresolvedExtensionTargets`
throws rather than warning.

The fix has three parts:

- A new `extension-points.ts` declaring the four `submission-drawer:*` hosts as `detail`-family
  injection hosts whose `source` is `SubmissionDrawer.tsx`.
- Binding them. The fact extractor's `hasDeclarationBinding` greps the host's declared `source` file
  for the literal `extensionPoints.hosts.<hostKey>`, so the drawer's exported spot constants now read
  their ids from `extensionPoints.hosts.*.spotId` instead of inline string literals. This is the
  house pattern (cf. `messages/components/MessageDetailPageClient.tsx`).
- Dropping the `forms:embed` mapping. That spot id is mounted by no file in this repo: the module's
  own embed surface, `frontend/embed/[slug]/page.tsx`, renders `<EmbeddedForm>` directly rather
  than through an injection spot, and the `embedded-form` widget's own documentation describes it
  as the generic primitive that *host* modules map against a spot of their own. The widget stays
  registered and reusable; only the dangling self-mapping is gone.

### 3. Eleven i18n keys referenced but never shipped (`yarn i18n:check-usage`)

The standalone package had no i18n gate, so these were referenced in code with no entry in any
locale file:

- `forms.invitation.email.{subject,heading,greeting,body,body_reminder,cta,footer}` — every call
  site passes an English fallback, so invitation mail still sent, but it could never be translated:
  pl/es/de recipients received English.
- `forms.runner.actions.{back,next,submit}` — the internal runner calls `t()` with **no** fallback,
  so `/forms/<id>/run` rendered the raw key strings (`forms.runner.actions.next`) as button labels.
- `forms.trigger.title` — the form dialog title.

Values match each call site's fallback; pl/es/de follow the module's existing tone (cf.
`forms.runner.section.actions.*`). `yarn i18n:check-sync` separately required the `ko.json` this
repo's five-locale set expects — forms shipped four — generated with EN placeholders, the
convention for a newly added locale file.

While adding the runner keys: the ending screen's success `Tag` was labelled with the *submit
action* key, so a post-submission badge read "Submit". A `forms.runner.actions.submitted` key was
added and the badge repointed.

### 4. Stale committed lucide registry (`yarn test`, `@open-mercato/ui`)

`packages/ui/src/backend/icons/lucideRegistry.generated.tsx` is a committed mirror of a repo-wide
icon scan. The Form Studio palette introduced twelve icon strings it did not carry (`align-left`,
`grid-3x3`, `hash`, `heading`, `list-ordered`, `paperclip`, `pen-tool`, `rows`,
`sliders-horizontal`, `toggle-left`, `toggle-right`, `type`).

Regenerating it is not what it looks like: `yarn build:packages` does **not** refresh the file,
because turbo caches the `@open-mercato/ui` build when ui's own inputs are unchanged — and the
registry depends on files in *other* packages. This is the exact drift the generator's own comment
documents (#4391). `node packages/ui/build.mjs` (or `yarn ui:icons:check` for guard mode) is what
actually refreshes it.

## Migration & Backward Compatibility

Per `BACKWARD_COMPATIBILITY.md`, adding a module is additive across every contract surface it
touches, so this migration breaks nothing already in the monorepo:

| Surface | Effect |
|---------|--------|
| Auto-discovery files | New files under a new module directory only |
| Public types / import paths | New paths under `@open-mercato/core/modules/forms/*`; none removed or renamed |
| Event IDs | New `forms.*` ids only |
| Widget spot IDs | Four new `submission-drawer:*` hosts, newly *declared* rather than changed |
| API routes | New `/api/forms/**` tree; no existing route touched |
| DB schema | New `forms_*` tables via the module's own migrations; no existing table altered |
| DI keys | New forms-scoped registrations |
| ACL features | New `forms.*` features |
| Generated files | Regenerated; the only cross-package edit is the additive lucide registry |

Two changes are not purely additive and are called out deliberately:

1. **`packages/core` gains three dependencies.** Anyone installing `@open-mercato/core` now pulls
   `ajv`, `ajv-formats` and `pdf-lib`.
2. **The `forms:embed` injection mapping is removed** relative to the source repo. Nothing in this
   repo mounted that spot, so there is no behaviour change here, but a downstream module that
   rendered `<InjectionSpot spotId="forms:embed">` against the official-modules copy would need to
   declare its own spot and map the widget itself — which is what the widget's documentation
   already instructs. Worth an `UPGRADE_NOTES.md` line if the official-modules package is ever
   deprecated in favour of this one.

The `official-modules` copy is unaffected and remains inert in this repo: the
`external/official-modules` submodule is not checked out and `official-modules.json` does not
activate `forms`. Retiring it there is separate work in that repository, and until it happens the
two copies can drift — so that PR should follow closely.

## Integration Coverage

Root `AGENTS.md` requires integration coverage for every affected API path and key UI path, shipping
in the same change. The vendored module arrives with ~65 unit test files (803 tests, all green here)
and **zero** integration tests, so the suite is authored as part of this migration. Priority-ordered
areas — the P0/P1/P2 breakdown lives in
[`.ai/analysis/forms-integration-test-plan.md`](../analysis/forms-integration-test-plan.md):

- form CRUD with ACL and tenant scoping, including cross-tenant denial and optimistic-locking 409s
- form versions: draft → compile → publish → fork, and version diff
- the public runner: start, autosave, submit, resume token, tamper rejection
- distributions: creation, the public `[slug]` route, embed policy, invitations and `[token]` redemption
- submissions: list/detail, revisions, reopen, actors, access audit, anonymize, export, PDF
- attachments on submissions, authenticated and anonymous
- rate limiting and captcha on the public endpoints
- the analytics endpoint
- the portal pages under `frontend/[orgSlug]/portal/forms/**`

Studio interactions that depend on real drag-and-drop go to browser QA rather than integration
tests.

## Security Review

The module's anonymous surface is the reason this migration needs more than a green gate: on merge,
`api/public/**` becomes the platform's public surface. A dedicated review covers the unauthenticated
routes and IDOR candidates, capability-token handling, rate limiting and captcha, upload validation
and download headers, embed/CSP policy, the JSONLogic evaluator and Ajv configuration, encryption
and log redaction, anonymisation completeness, and module-wide tenant scoping. Findings and their
disposition live in [`.ai/analysis/forms-security-review.md`](../analysis/forms-security-review.md).

## Known limitations

### The `/embed/:slug` surface is inert (follow-up, not a regression)

The module's embed surface needs a per-distribution
`Content-Security-Policy: frame-ancestors <allowedDomains>` response header on `/embed/:slug`, and
needs the app's global frame protection to carve `/embed/` out so that header is the sole authority.
Neither exists here: `apps/mercato/next.config.ts` applies `frame-ancestors 'self'` plus
`X-Frame-Options: SAMEORIGIN` to `/:path*`, and `apps/mercato/src/proxy.ts` never calls the
module's `GET /api/forms/public/distributions/:slug/embed-policy`.

This is **not** something the migration dropped. The source repository's own sandbox app declares no
`headers()` block at all, so `/embed/:slug` was framable there by default rather than by policy — the
plumbing the module's doc comments describe has never been implemented anywhere. Those comments have
been corrected in `frontend/embed/[slug]/page.meta.ts` and on the `embed-policy` route so they no
longer assert a mechanism that does not exist.

Current behaviour is **fail-closed**: this repo's global policy blocks cross-origin framing of
`/embed/:slug` outright. The surface is therefore safe and inert. Everything beneath the header is
complete and unit-tested — availability/cap/CAPTCHA enforcement, theme application, the origin
normalizer in `lib/embed-frame-policy.ts`, the `embed-policy` endpoint.

Deliberately deferred rather than fixed here, for three reasons:

1. **It is new feature work.** Nothing regressed; a capability that never worked would start working.
   A behaviour-preserving migration is the wrong PR to introduce it in.
2. **Both halves are load-bearing and the failure mode is clickjacking.** A `next.config.ts` carve-out
   without the dynamic header would leave the page framable by *anyone* — strictly worse than blocked.
   Shipping only the easy half is not an option.
3. **It cannot be verified without a browser.** It depends on Next.js's precedence between
   `next.config.ts` `headers()` and proxy-set response headers, and on whether a present
   `frame-ancestors` reliably supersedes `X-Frame-Options` across target browsers. That needs a real
   framing page against a real distribution, i.e. its own QA pass.

It also cannot use the page-middleware convention (`frontend/middleware.ts`): that executor is invoked
from inside React Server Components (`app/(frontend)/[...slug]/page.tsx`), which cannot set response
headers, and its `PageMiddlewareResult` supports only `continue` and `redirect`. A per-request header
has to come from the proxy. That in turn means module-specific code under `apps/mercato/src/`, which
root `AGENTS.md` forbids — so the follow-up should either extend the proxy with a *generic*
module-declared response-header contract, or accept a documented exception with the same justification
as `next.config.ts`'s existing `/api/attachments/file/:path*` block.

## Open Questions

1. ~~**Are the copied migrations and `.snapshot-open-mercato.json` valid here?**~~ **Resolved:
   yes.** MikroORM tracks migration state in a per-module table (`mikro_orm_migrations_forms`), and
   32 other in-repo module snapshots share this one's exact shape — a snapshot containing only its
   own module's tables. None of forms' six migration class names or timestamps collides with any of
   the 339 migration files in the repo, and all eleven `forms_*` tables grep to zero hits outside
   `modules/forms/`. One thing remains unproven: `yarn db:generate` needs a live Postgres, so the
   snapshot has not been diffed against the entities by the generator. Structurally it should emit
   nothing. Run it once before merge; never run `yarn db:migrate`.
2. ~~**Are the `api/public/**` routes actually left unauthenticated by this repo's middleware?**~~
   **Resolved.** Auth is per-route metadata, not middleware, and every `api/public/**` route
   declares `requireAuth: false` explicitly, as do the `/f/:slug`, `/i/:token` and `/embed/:slug`
   page metas. The two routes that declared it *wrongly* — `api/[id]/run/context` and
   `api/[id]/run/submissions`, unauthenticated and unscoped by tenant — were found and fixed; see
   the commit "close the unauthenticated cross-tenant read on the in-app runner".
3. **Should a module-level `packages/core/src/modules/forms/AGENTS.md` ship?** Recommendation from
   the wiring audit: **no.** The `packages/core` instruction chain is already ~39.8 KB over the
   32 KB agent budget, so every byte of a new module file at the tail would be truncated before an
   agent read it — and the budget baseline would not even flag the regression. Adding a single
   ~89-byte Task Router row to root `AGENTS.md` already fails the check (31295 / 31232). Routing
   agents to this spec is the cheaper answer until the chain is trimmed.
4. **Should the six `forms.*` ACL features be granted beyond `admin`?** `setup.ts` grants all six to
   `admin` only; most core modules also give `employee` a read subset. Left as the module authored
   it — widening access is a policy decision, not a migration fix.

## Changelog

- 2026-09-30 — Spec created alongside the in-progress migration. Vendoring, app registration,
  react-table drift, i18n keys, injection-host declaration and the lucide registry are done;
  migrations validity, the security and DS findings, integration coverage, browser QA and the code
  review are outstanding.
