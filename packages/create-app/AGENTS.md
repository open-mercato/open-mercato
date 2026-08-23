# Create App Package — Agent Guidelines

Use `packages/create-app` to scaffold standalone Open Mercato applications via `npx create-mercato-app my-app`.

## Always

1. **MUST test both environments** — verify changes work in monorepo (`yarn dev` / `yarn dev:verbose` when relevant) AND standalone app (via Verdaccio)
2. **MUST keep `@types/*` in `dependencies`** (not `devDependencies`) — standalone apps need type declarations at runtime
3. **MUST follow build order** — `yarn build:packages` → `yarn generate` → `yarn build:packages`
4. **MUST build before publishing** — generators scan `node_modules/@open-mercato/*/dist/modules/` for `.js` files
5. **MUST sync template equivalents** — touching ANY file under `apps/mercato/src/app/**` (layouts, providers, and route/page behavior like a `page.tsx` handoff), any locale key in `apps/mercato/src/i18n/**`, or any env var in `apps/mercato/.env.example` means mirroring YOUR change into the template counterpart (`packages/create-app/template/src/app/**`, `packages/create-app/template/src/i18n/**`, `packages/create-app/template/.env.example`) in the same task; if genuinely monorepo-only, say so in the PR. Some pairs intentionally diverge (`globals.css`, docs API routes, template-only `api/healthz`, env comments) — mirror your change, don't fix pre-existing drift. The locale dictionaries do NOT diverge: they are a byte-exact mirror enforced by `packages/create-app/src/lib/template-i18n-parity.test.ts`, and `yarn template:sync:fix` is what repairs them
6. **MUST keep template module registrations and package dependencies aligned** — if `packages/create-app/template/src/modules.ts` enables a package-backed module (for example `@open-mercato/webhooks`), `packages/create-app/template/package.json.template` must install that package in the same change, and the template lockfile must be reviewed when dependency shape changes
7. **MUST preserve imported ready apps as raw source snapshots** — `--app` / `--app-url` imports may add only bootstrap-safe generated artifacts (for example `.mercato/generated/module-package-sources.css`)
8. **MUST keep standalone agent guidance aligned with generator behavior** — if `yarn generate` gains post-steps such as structural cache purging, update `packages/create-app/template/AGENTS.md` and `packages/create-app/agentic/shared/AGENTS.md.template` in the same task
9. **MUST keep the generated standalone root inside its byte budget** — the scaffolded `AGENTS.md` targets `STANDALONE_ROOT_TARGET_BYTES` (12 KiB) so a routed chain still fits Codex's 32 KiB `project_doc_max_bytes`. `enforceRootInstructionBudget` runs after every tool generator has patched the root and sheds the enumerated module-fact index for an O(1) pointer form rather than overflowing, so enabling another template module is safe — but an addition that trips the fallback costs the app its inline routing index and fails `packages/create-app/src/lib/agent-instruction-budget.test.ts`. Reclaim root bytes or accept the fallback deliberately; do not raise the target without re-measuring the routed chains
10. **MUST make Git-history provenance gates work in shallow CI checkouts** — fetch the missing ancestry before asserting it, and fail closed when the history cannot be fetched or verified

## Ask First

- Ask before changing scaffold modes, ready-app import behavior, agentic setup generation, or template package dependency shape.
- Ask before publishing canary or registry changes if the task did not explicitly request a release test.

## Never

- Never break the standalone app template — it's the user's first experience with Open Mercato.
- Never rewrite package versions, source files, or inject agentic setup files into imported ready apps.
- Never run the interactive agentic wizard for imported ready apps; any agentic tooling must be added later via a deliberate manual command inside the generated app.
- Never leave app-shell changes unsynced between monorepo and template equivalents.

## Validation Commands

```bash
yarn build:packages
yarn generate
yarn build:packages
yarn test:create-app
yarn test:create-app:integration
```

## Standalone App vs Monorepo

| Aspect | Monorepo | Standalone App |
|--------|----------|----------------|
| Package source | Local workspace (`packages/`) | npm registry or Verdaccio |
| Package format | TypeScript source (`src/`) | Compiled JavaScript (`dist/`) |
| Generators read from | `src/modules/*.ts` | `dist/modules/*.js` |
| Module location | `apps/mercato/src/modules/` | `src/modules/` (app root) |

## Template Sync Checklist

When changes affect app shell behavior, verify all relevant template files are reviewed and updated. The list is a floor, not exhaustive — mirror any `src/app/**` file you touched; pre-existing intentional drift is fine:

1. `apps/mercato/src/app/layout.tsx` ↔ `packages/create-app/template/src/app/layout.tsx`
2. `apps/mercato/src/app/(backend)/backend/layout.tsx` ↔ `packages/create-app/template/src/app/(backend)/backend/layout.tsx`
3. `apps/mercato/src/components/*` wrappers used by layouts ↔ `packages/create-app/template/src/components/*`
4. `scripts/dev.mjs` ↔ `packages/create-app/template/scripts/dev.mjs`
5. `scripts/dev-log-files.mjs` ↔ `packages/create-app/template/scripts/dev-log-files.mjs`
6. `scripts/dev-splash.html` ↔ `packages/create-app/template/scripts/dev-splash.html`
7. `scripts/dev-splash-helpers.mjs` ↔ `packages/create-app/template/scripts/dev-splash-helpers.mjs`
8. `apps/mercato/scripts/dev.mjs` ↔ `packages/create-app/template/scripts/dev-runtime.mjs`
9. `apps/mercato/src/app/page.tsx` ↔ `packages/create-app/template/src/app/page.tsx`
10. `apps/mercato/.env.example` ↔ `packages/create-app/template/.env.example` (env var names + their doc comments)
11. `apps/mercato/src/i18n/*.json` ↔ `packages/create-app/template/src/i18n/*.json` — kept **byte-identical** by `yarn template:sync:fix` and enforced by `packages/create-app/src/lib/template-i18n-parity.test.ts`. The `scripts/i18n-check-*` gates all ignore `create-app/template/**`, so that test is the only thing that catches locale drift; a scaffold with a missing key silently renders the English default in every locale (#4738)

Telemetry / observability wiring (keep at parity when the `@open-mercato/telemetry` integration changes):

9. `apps/mercato/src/instrumentation.ts` ↔ `packages/create-app/template/src/instrumentation.ts` (both check `isTelemetryBackendEnabled` from shared code before dynamically importing `registerTelemetryForNextjs`; the package is not loaded while off)
10. `apps/mercato/src/app/api/[...slug]/route.ts` ↔ `packages/create-app/template/src/app/api/[...slug]/route.ts` (kept **byte-identical** — enforced by `packages/create-app/src/lib/template-api-dispatcher-require-roles.test.ts`; both call the optional shared telemetry runtime bridge rather than statically importing telemetry)
11. `apps/mercato/next.config.ts` ↔ `packages/create-app/template/next.config.ts` — both spread `telemetryServerExternalPackages` from the runtime-free `@open-mercato/telemetry/nextjs-config` entrypoint into `serverExternalPackages`. The `@opentelemetry/*` list lives in the package (single source of truth); do **not** re-inline it.
12. `apps/mercato/.env.example` telemetry block (`TELEMETRY_*` / `OTEL_*`) ↔ `packages/create-app/template/.env.example`
13. `packages/cli/src/lib/telemetry-init.ts` (the `mercato telemetry init` adoption command) embeds copies of the `.env` telemetry block and the `instrumentation.ts` bootstrap so it can patch a pre-telemetry app — keep those constants in sync when items 9/12 change.
14. `@open-mercato/telemetry` dep + `bullmq-otel` optionalDep ↔ `packages/create-app/template/package.json.template` (telemetry ships the `@opentelemetry/*` SDK as transitive `optionalDependencies`, so the template only pins `@open-mercato/telemetry`). Because the template pins every `@open-mercato` dep to `{{PACKAGE_VERSION}}`, the telemetry package version MUST stay in monorepo lockstep — `scripts/check-version-alignment.sh` enforces it, and a fresh scaffold's `yarn install` fails otherwise.

## Dev Runtime Expectations

- `yarn dev` is the compact runtime. It folds routine startup logs and lets the user press `d` to show or hide raw logs.
- `yarn dev:verbose` is the raw passthrough variant and MUST stay available for debugging.
- When changing dev DX, verify both monorepo and standalone runtimes still expose the same debugging escape hatches and startup states.

## Standalone App Structure

```
my-app/
├── src/
│   └── modules/           # User's custom modules (.ts files)
├── node_modules/
│   └── @open-mercato/     # Installed packages (compiled .js)
├── .mercato/
│   └── generated/         # Generated files from CLI
└── package.json
```

## Ready App Import Modes

`create-mercato-app` supports three scaffold modes:

1. Bare scaffold: `npx create-mercato-app my-app`
2. Official ready app: `npx create-mercato-app my-prm --app prm`
3. External GitHub ready app: `npx create-mercato-app my-app --app-url https://github.com/some-agency/ready-app-marketplace`

Rules:

- `--app` resolves to `open-mercato/ready-app-<name>` and MUST use the exact tag `v<create-mercato-app version>`
- `--app-url` only supports GitHub repository URLs in v1, optionally with `/tree/<ref>`
- `--app` and `--app-url` are mutually exclusive
- Imported ready apps skip template processing and the interactive agentic wizard
- Imported ready apps must be committed source snapshots; fail closed if `.template` files are present

## Testing with Verdaccio

### Initial Setup

```bash
# Optional: create a registry user once if you want npm auth stored for Verdaccio
yarn registry:setup-user
```

### Fast Path via Root Scripts

```bash
# Smoke-test the standalone scaffold against Verdaccio
yarn test:create-app

# Run the standalone integration parity flow against Verdaccio
yarn test:create-app:integration
```

### Manual Verdaccio Workflow

```bash
docker compose up -d verdaccio
yarn registry:publish
node packages/create-app/dist/index.js /tmp/my-test-app --verdaccio
cd /tmp/my-test-app
yarn install
yarn setup
```

### When Publishing Changes

1. Make changes in monorepo packages
2. Use `yarn test:create-app` for the fast scaffold smoke test (interactive shells open in the generated app by default; pass `--no-shell` to skip that), `yarn test:create-app:integration` for parity coverage, or the manual Verdaccio workflow when you want to keep a standalone app around
3. If you already have a standalone app checked out, rerun `yarn registry:publish`, then in that app run `rm -rf node_modules .mercato/next && yarn install && yarn dev`
4. Verify the app starts and affected features work
5. Test `yarn generate` produces correct output from compiled files

### Canary Releases

```bash
./scripts/release-snapshot.sh canary
# Creates version like: 0.4.9-canary.1523.abc1234567
npx create-mercato-app@0.4.9-canary.1523.abc1234567 my-test-app
```

### Cleanup

```bash
npm config delete @open-mercato:registry
docker stop verdaccio && docker rm verdaccio
```

## Agentic Setup Maintenance

The `agentic/` directory contains standalone-app-specific AI coding tool configurations. This content is **purpose-built for standalone apps** — it is NOT a copy of the monorepo's `.ai/` folder.

### Directory Structure

```
packages/create-app/agentic/
├── shared/                      # Always generated (AGENTS.md, .ai/ structure)
│   ├── AGENTS.md.template       # {{PROJECT_NAME}} placeholder substitution
│   ├── scripts/
│   │   ├── install-skills.mjs  # Node installer; owns canonical skill discovery, pins, integrity, and refresh
│   │   ├── install-skills.sh   # Compatibility wrapper for existing direct callers; automatic paths use Node
│   │   ├── framework-context.mjs # Exact installed source/AGENTS resolver
│   │   └── *-agent-harness*.mjs # Deterministic, live, writable, review, and release gates
│   └── ai/
│       ├── agentic.config.json  # Standalone agentic config (baseBranch auto → tracker default-branch, tracker github, validation, labels off)
│       ├── trackers/github.md   # GitHub tracker descriptor (copied verbatim from the monorepo)
│       ├── skills/
│       │   ├── tiers.json       # Local tier manifest + external open-mercato/skills subset
│       │   ├── tiers.schema.json
│       │   └── om-*/            # Local skills + repo-local OVERRIDE folders (SKILL.md only) for external auto-* skills
│       └── specs/               # Spec templates for standalone apps
├── claude-code/                 # Claude Code tool config
│   ├── CLAUDE.md.template       # {{PROJECT_NAME}} placeholder substitution
│   ├── settings.json            # PostToolUse hook registration
│   ├── hooks/entity-migration-check.ts  # TypeScript hook (requires tsx)
│   └── mcp.json.example
├── codex/                       # Codex tool config
│   ├── enforcement-rules.md     # Prepended to AGENTS.md with marker comments
│   └── mcp.json.example
└── cursor/                      # Cursor tool config
    ├── rules/*.mdc              # Glob-scoped rules (alwaysApply + entity/generated guards)
    ├── hooks.json               # afterFileEdit hook registration
    ├── hooks/entity-migration-check.mjs  # Plain ESM (no tsx dependency)
    └── mcp.json.example
```

### Skills Mixin (external open-mercato/skills + local overrides)

Scaffolded apps combine repo-local standalone knowledge with a dependency-closed subset of shared delivery skills. Both the create-app wizard and CLI `agentic:init` invoke `scripts/install-skills.mjs` through `process.execPath` after generating the harness. Installation is best-effort at setup time: local skills remain usable when the pinned external archive is unavailable, and the user can retry with `yarn install-skills`. `--skip-agentic-setup` / `--agents none` skips agentic generation entirely. `OM_SKIP_EXTERNAL_SKILLS=1` or `--no-external` installs only selected local tiers.

- **`agentic/shared/ai/skills/tiers.json`** — declares the default `core` local tier, opt-in `automation` and versioned `migration` tiers, the selected agents to ignore, and matching explicit external tiers. The external block pins the exact `open-mercato/skills` commit, selected skill names, dependency closure, and SHA-256 content hash for every available skill. The default external `core` tier is the minimal daily set; loop/issue/release-maintenance workflows belong to the opt-in `automation` tier. External names MUST NOT also appear in local tiers; when adding one, update its tier assignment, complete dependency closure, and hash in the manifest.
- **`agentic/shared/scripts/install-skills.mjs`** — cross-platform Node 24 installer and sole owner of skill discovery layout. It validates the manifest before writing, selects the external tiers matching `--with`/`--tiers`/`--all`, downloads the exact external commit, validates the archive as a regular-file-only tree, and copies only the integrity-pinned `skills/<name>` directories without executing repository or package-runner code. It verifies every hidden staged copy, atomically activates the entire verified external set with all-set rollback, and records `.agents/skills/.om-external-ownership.json` only after every activation succeeds. Re-runs are idempotent for the same pins. Unknown real directories are preserved/refused; stale, modified, or unverifiable external copies are moved to `.agents/skills-quarantine/` instead of being silently trusted or deleted. External installation happens before local links are reconciled.
- **Discovery layout and flags** — `.agents/skills/<name>` is canonical. Local skills are managed links into `.ai/skills/`; verified external skills are real canonical directories. Claude Code receives per-skill links under `.claude/skills/`; Codex and Cursor read `.agents/skills/` directly. Legacy harness-owned links are swept safely while user-owned paths are preserved. Supported options are `--with <csv>`, `--tiers <csv>`, `--all`, `--legacy-links`, `--ignore-agents <csv>`, `--no-external`, `--list`, and `--clean`; the tier selectors are mutually exclusive. `--legacy-links` additionally exposes Claude and Codex links. The generated package script invokes the Node file directly; `install-skills.sh` remains only a thin compatibility wrapper.
- **Repo-local override folders** — `om-auto-create-pr`, `om-auto-continue-pr`, `om-auto-implement-spec`, `om-auto-review-pr`, and `om-auto-fix-issue` ship slim standalone override `SKILL.md` files (default-branch discovery, opt-in labels, `src/modules/…` layout, and spec-readiness/no-remote behavior where applicable). The installed external skill reads the same-name file as additional repo context; the installer never links that local folder over the verified external copy. `om-prepare-test-env` likewise ships a knowledge-only standalone extension for the cross-platform mercato CLI ephemeral runner, probe contract, and teardown. Generated `test-env-*` entrypoints are machine-bound and gitignored; never commit them. Do not add a same-name folder for another external skill unless it has a concrete standalone delta.
- **`agentic/shared/ai/agentic.config.json` + `ai/trackers/github.md`** — the repo-specific agentic settings and tracker descriptor the external skills read. The tracker is copied verbatim from the monorepo (keep its `attach-image-evidence` operation).

Both generators recursively emit the same `agentic/` source tree: `src/setup/tools/shared.ts` for the create-app wizard and `packages/cli/src/lib/agentic-setup.ts` for `mercato agentic:init`. They use the same deterministic text/binary copy contract, placeholder handling, module-row injection, agent selection, and generated ownership manifest. `--update-harness` refreshes unchanged owned assets, preserves locally modified or unknown files, and writes `.incoming` candidates for conflicts; `--force` replaces exact generated targets but never unrelated user files. Package builds stage a complete `agentic` tree, then publish it by copying before pruning target-only files so concurrent readers never observe an empty `dist/agentic` and removed assets cannot survive as stale output. The package test command builds once before Node starts its parallel test files; individual test files must not rebuild shared `dist/` outputs. Keep recursive generation, ownership semantics, and tests in parity whenever the source tree changes.

### When to Update `agentic/`

- When module conventions change (entity lifecycle, migration workflow, `yarn generate` behavior)
- When the local skill set or the external open-mercato/skills subset changes (update `tiers.json`, both copy pipelines, and the overlay test)
- When adding new auto-discovery paths or module files
- When changing CLI commands that standalone apps use
- When the entity-migration hook logic needs adjustment

### Key Constraints

- `agentic/` files are static assets copied to `dist/agentic/` by `build.mjs` — they are NOT bundled by esbuild
- `.ai/lessons.md` stays a compact tagged index; nested `.ai/lessons/*.md` records are user-editable harness assets and `scripts/check-lessons.mjs` enforces index/metadata parity
- Generator code lives in `src/setup/tools/` — each tool has its own generator
- The Codex generator patches `AGENTS.md` (created by shared generator) — ordering matters
- `{{PROJECT_NAME}}` is the only placeholder; resolved from `path.basename(targetDir)`
- Cursor hook is `.mjs` (no tsx dep); Claude Code hook is `.ts` (needs tsx in devDependencies)
