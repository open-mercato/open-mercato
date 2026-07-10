# Create App Package — Agent Guidelines

Use `packages/create-app` to scaffold standalone Open Mercato applications via `npx create-mercato-app my-app`.

## Always

1. **MUST test both environments** — verify changes work in monorepo (`yarn dev` / `yarn dev:verbose` when relevant) AND standalone app (via Verdaccio)
2. **MUST keep `@types/*` in `dependencies`** (not `devDependencies`) — standalone apps need type declarations at runtime
3. **MUST follow build order** — `yarn build:packages` → `yarn generate` → `yarn build:packages`
4. **MUST build before publishing** — generators scan `node_modules/@open-mercato/*/dist/modules/` for `.js` files
5. **MUST sync template equivalents** — touching ANY file under `apps/mercato/src/app/**` (layouts, providers, and route/page behavior like a `page.tsx` handoff) or any env var in `apps/mercato/.env.example` means mirroring YOUR change into the template counterpart (`packages/create-app/template/src/app/**`, `packages/create-app/template/.env.example`) in the same task; if genuinely monorepo-only, say so in the PR. Some pairs intentionally diverge (`globals.css`, docs API routes, template-only `api/healthz`, env comments) — mirror your change, don't fix pre-existing drift
6. **MUST keep template module registrations and package dependencies aligned** — if `packages/create-app/template/src/modules.ts` enables a package-backed module (for example `@open-mercato/webhooks`), `packages/create-app/template/package.json.template` must install that package in the same change, and the template lockfile must be reviewed when dependency shape changes
7. **MUST preserve imported ready apps as raw source snapshots** — `--app` / `--app-url` imports may add only bootstrap-safe generated artifacts (for example `.mercato/generated/module-package-sources.css`)
8. **MUST keep standalone agent guidance aligned with generator behavior** — if `yarn generate` gains post-steps such as structural cache purging, update `packages/create-app/template/AGENTS.md` and `packages/create-app/agentic/shared/AGENTS.md.template` in the same task

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
11. `.ai/scripts/test-env-up.sh` / `test-env-down.sh` (repo root, om-prepare-test-env entrypoints) ↔ `packages/create-app/template/.ai/scripts/` — the template copies are standalone-adapted (app root instead of `apps/mercato`, `yarn test:integration:ephemeral:start` as the up command, no monorepo CI-parity env block); mirror behavioral fixes, not monorepo-specific lessons

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
│   │   └── install-skills.sh    # Copied to <app>/scripts/; `yarn install-skills` (per-skill symlinks + npx skills add/update)
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

Scaffolded apps handle skills the same mixin way the monorepo does. Both the agentic wizard and the CLI `agentic:init` command run `scripts/install-skills.sh` automatically at the end of setup (best-effort: a failed install prints a warning and the user re-runs `yarn install-skills`). `--skip-agentic-setup` / `--agents none` skips it entirely, and `OM_SKIP_EXTERNAL_SKILLS=1` keeps the run offline (local tier symlinks only, no `npx skills add`/`update`). The `--skill` subset MUST be passed as repeated `--skill <name>` flags — the skills CLI matches each value verbatim and does not split commas.

- **`agentic/shared/ai/skills/tiers.json`** — declares the local tiers (standalone-only + kept-local skills, one tier each) and an `external` block listing the exact subset of the shared [open-mercato/skills](https://github.com/open-mercato/skills) collection this app installs: the auto-* PR family, `om-code-review`, `om-spec-writing`, `om-integration-tests`, `om-prepare-issue`, `om-auto-fix-issue`, plus the hard dependencies those skills invoke — `om-prepare-test-env` (required by `om-integration-tests`), the autofix chain steps `om-verify-in-repo`/`om-root-cause`/`om-fix`/`om-open-pr` (required by `om-auto-fix-issue`) — and the pipeline maintenance pair `om-setup-agent-pipeline` and `om-apply-upgrade-notes`. When adding an external skill, install its dependency closure too (the overlay test's `EXTERNAL_SKILL_HARD_DEPS` map guards the known chains). External skills MUST NOT also appear in a local tier.
- **`agentic/shared/scripts/install-skills.sh`** — POSIX `sh`. Reads `tiers.json`, symlinks local tier skills per-skill into `.claude/skills/` / `.codex/skills/` (replacing any legacy directory-level symlink), then optionally runs `npx skills add … --skill '<csv>'` (only the explicit subset, never `'*'`) + `npx skills update`. Supports `--no-external` / `OM_SKIP_EXTERNAL_SKILLS=1`, `--list`, `--clean`, `--with`/`--tiers`/`--all`. Wired via the `install-skills` script in `template/package.json.template`; `.agents/skills/` + `skills-lock.json` are gitignored.
- **Repo-local override folders** — the auto-* skills (`om-auto-create-pr`, `om-auto-continue-pr`, `om-auto-create-pr-loop`, `om-auto-continue-pr-loop`, `om-auto-review-pr`) and `om-auto-fix-issue` ship as slim OVERRIDE folders under `agentic/shared/ai/skills/` containing only a `SKILL.md` (the standalone deltas — default-branch discovery, opt-in labels, `src/modules/…` layout). The external skill reads these on top of its built-in workflow; they are never installed as standalone skills. The remaining external skills (`om-code-review`, `om-spec-writing`, `om-integration-tests`, `om-prepare-issue`, `om-prepare-test-env`, `om-verify-in-repo`, `om-root-cause`, `om-fix`, `om-open-pr`, `om-setup-agent-pipeline`, `om-apply-upgrade-notes`) have NO override (config covers them) — do not ship a folder for them.
- **`agentic/shared/ai/agentic.config.json` + `ai/trackers/github.md`** — the repo-specific agentic settings and tracker descriptor the external skills read. The tracker is copied verbatim from the monorepo (keep its `attach-image-evidence` operation).

Both copy pipelines read from `agentic/` and MUST stay in sync when the skill set changes: `src/setup/tools/shared.ts` (create-app wizard) and `packages/cli/src/lib/agentic-setup.ts` (CLI `agentic:init`). `build.mjs` copies the whole `agentic/` tree verbatim to `dist/agentic/`, so new files under it need no build change. The overlay/override contract is guarded by `src/lib/agentic-skills-standalone-overlays.test.ts`.

### When to Update `agentic/`

- When module conventions change (entity lifecycle, migration workflow, `yarn generate` behavior)
- When the local skill set or the external open-mercato/skills subset changes (update `tiers.json`, both copy pipelines, and the overlay test)
- When adding new auto-discovery paths or module files
- When changing CLI commands that standalone apps use
- When the entity-migration hook logic needs adjustment

### Key Constraints

- `agentic/` files are static assets copied to `dist/agentic/` by `build.mjs` — they are NOT bundled by esbuild
- Generator code lives in `src/setup/tools/` — each tool has its own generator
- The Codex generator patches `AGENTS.md` (created by shared generator) — ordering matters
- `{{PROJECT_NAME}}` is the only placeholder; resolved from `path.basename(targetDir)`
- Cursor hook is `.mjs` (no tsx dep); Claude Code hook is `.ts` (needs tsx in devDependencies)
