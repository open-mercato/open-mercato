# Installer Skill Packages (Phase 2 of collaborative proposal skills)

> Status: **DRAFT — ready for implementation review**
> Scope: OSS · `packages/create-app` agentic installer (`wizard.ts` + `generateShared()`)
> Builds on: `.ai/specs/2026-06-15-collaborative-proposal-skills.md` (Phase 1, shipped)

## TLDR

Give the `create-mercato-app` agentic installer a **skill-package selection** step. Today
`generateShared()` copies a single hardcoded flat list of skills; the wizard only asks which AI
tool to use. Phase 2 introduces a **package manifest** (`packages.json`, mirroring the monorepo
`tiers.json`), refactors `generateShared()` to copy skills from that manifest, and adds a wizard
prompt — *"Which skill packages do you want to install?"* — shown for every tool. The
collaborative ideation skills (`om-proposal`, `om-brainstorm`) form a new opt-in **`creative`**
package, realizing the original `wsad.md` ask. Accept-defaults / non-interactive runs install
today's full set (so nothing regresses); only `creative` is newly opt-in.

## Resolved decisions (Open Questions gate)

- **Q1 → JSON manifest.** A `packages.json` under `agentic/shared/ai/skills/` in the `tiers.json`
  shape (`{ default: [...], packages: { name: { description, skills: [...], extraFiles?: [...] } } }`).
- **Q2 → opt-in, named `creative`.** The ideation skills live in a `creative` package, **default OFF**.
- **Q3 → always.** The package prompt is shown regardless of the selected tool (Codex/Cursor also get `.ai/skills/`).
- **Q4 → `--skill-packages` flag + today's set as default.** Accept-defaults, non-TTY, and
  `--skip-agentic-setup` install the default set (= every package currently shipped, i.e. all
  except `creative`). A `--skill-packages <csv>` CLI flag overrides for scripted scaffolds/tests.

## Problem Statement

`generateShared()` (`packages/create-app/src/setup/tools/shared.ts`) is a flat, hardcoded copy
list: every standalone app gets every shipped skill, with no way to choose, and the list is getting
long and hard to maintain. `wsad.md` explicitly asked for an installer question selecting which
skill *packages* to install, with the collaborative ideation skills as one package. The standalone
installer has no grouping abstraction today — even though the monorepo already groups skills via
`.ai/skills/tiers.json` + `install-skills.sh`.

## Design

### 1. Package manifest — `agentic/shared/ai/skills/packages.json`

Mirrors the monorepo `tiers.json` schema, with an optional `extraFiles` for non-skill fragments a
package owns (e.g. an optional reference inside an otherwise-core skill):

```json
{
  "$schema": "./packages.schema.json",
  "default": ["core", "automation", "integrations", "migration"],
  "packages": {
    "core":         { "description": "Daily-driver skills (always installed).", "skills": ["om-spec-writing", "om-implement-spec", "om-code-review", "om-backend-ui-design", "om-data-model-design", "om-module-scaffold", "om-integration-tests", "om-troubleshooter", "om-help", "om-system-extension", "om-eject-and-customize"] },
    "automation":   { "description": "PR/issue automation.", "skills": ["om-auto-create-pr", "om-auto-continue-pr", "om-auto-create-pr-loop", "om-auto-continue-pr-loop", "om-auto-review-pr", "om-auto-fix-github", "om-prepare-issue", "om-trim-unused-modules"] },
    "integrations": { "description": "Integration provider builder.", "skills": ["om-integration-builder"] },
    "migration":    { "description": "Version-pinned upgrade helpers.", "skills": ["om-auto-upgrade-0.4.10-to-0.5.0"] },
    "creative":     { "description": "Collaborative pre-spec ideation (proposals + brainstorming).", "skills": ["om-proposal", "om-brainstorm"], "extraFiles": ["om-spec-writing/references/proposal-intake.md"] }
  }
}
```

- `core` is **forced** — always installed even if not selected.
- `default` lists what an accept-defaults run installs (everything except `creative`).
- `extraFiles` are package-owned files that live under a skill not in this package (here: the
  optional `proposal-intake.md` fragment of the core `om-spec-writing`). They ship only when the
  owning package is selected — realizing the Phase-1 Q3 gating.

### 2. `generateShared()` refactor

Replace the flat skill-copy block with manifest-driven copying. Non-skill assets (`AGENTS.md.template`,
`.ai/specs/`, `.ai/qa/`, package guides) are unchanged.

- Extract a **pure resolver** `resolveSkillFiles(selectedPackages, manifest)` → ordered list of
  relative paths to copy (skill dirs of `core` ∪ selected packages, plus their `extraFiles`),
  deduped, `core` always included. This is unit-testable without the filesystem.
- For each resolved skill folder, copy `SKILL.md` + everything under `references/` recursively.
  Apply `{{PROJECT_NAME}}` substitution to every copied text file (a no-op when no placeholder),
  collapsing the current `writeTemplate`-vs-`copyFile` split into one placeholder-safe copy path.
- `generateShared` receives `config.skillPackages: string[]`.

### 3. Wizard + CLI

- **`wizard.ts`**: after tool selection, always run a package prompt. Multi-select (comma-separated
  numbers like the tool prompt); `core` shown as forced/always-on; empty input → `default` set.
  Honor `config.skillPackages` when provided (skip the prompt). Non-TTY → `default` set.
- **`index.ts`**: parse `--skill-packages <csv>` (validated against manifest package names; unknown
  name → friendly error listing valid packages) and thread it into `AgenticConfig.skillPackages`.
  Add usage text. `--skip-agentic-setup` and non-TTY keep installing the default set.

### 4. Validation + tests

- Manifest coverage guard in `shared.test.ts`: parse `packages.json`; assert every skill folder
  under `agentic/shared/ai/skills/` is assigned to **exactly one** package, every `default` entry
  names a real package, and every `extraFiles` path exists on disk.
- Resolver unit tests: `core` always present; `creative` selected ⇒ `om-proposal`/`om-brainstorm` +
  `proposal-intake.md`; `creative` absent ⇒ none of those; default set = today's full set.
- Wizard parsing tests: empty → default; explicit csv → that set + forced `core`; invalid name → error.

## Phasing

### Phase 1 — Manifest + coverage guard

| Step | Deliverable |
|------|-------------|
| 1.1 | Author `agentic/shared/ai/skills/packages.json` (+ `packages.schema.json`) with the taxonomy above. |
| 1.2 | `shared.test.ts` coverage guard: every skill folder in exactly one package; `default`/`extraFiles` valid. |

### Phase 2 — generateShared refactor (manifest-driven)

| Step | Deliverable |
|------|-------------|
| 2.1 | Extract pure `resolveSkillFiles(selected, manifest)` (core forced, dedupe, extraFiles) + unit tests. |
| 2.2 | Refactor `generateShared()` skill-copy block to drive from resolver; unify on placeholder-safe copy; keep non-skill assets unchanged. |
| 2.3 | Gate `creative` `extraFiles` (`proposal-intake.md`) on selection (subsumed by resolver). |

### Phase 3 — Wizard + CLI flag

| Step | Deliverable |
|------|-------------|
| 3.1 | `--skill-packages <csv>` parsing + validation + usage text in `index.ts`; thread into `AgenticConfig`. |
| 3.2 | Wizard package prompt (always; multi-select; `core` forced; empty→default; honor override; non-TTY→default). |
| 3.3 | Wizard/parsing unit tests (default / explicit / invalid / core-forced). |

### Phase 4 — Docs + alignment

| Step | Deliverable |
|------|-------------|
| 4.1 | Update create-app `AGENTS.md` (Agentic Setup Maintenance) to document `packages.json` + the prompt. |
| 4.2 | Update Phase-1 spec cross-ref; note `creative` is now opt-in (default scaffold no longer ships proposal/brainstorm unless selected). |

## Backward Compatibility

- The flat-list → manifest refactor is internal to `generateShared()`; an accept-defaults run ships
  the same set as today **except** the newly opt-in `creative` package (Phase 1 had shipped
  proposal/brainstorm unconditionally; that release has not gone out, so the default change is safe
  and intentional). No other skill is dropped.
- Additive wizard step + additive CLI flag. `--skip-agentic-setup` and non-TTY paths preserved.
- Monorepo `tiers.json` / `install-skills.sh` untouched; the standalone `packages.json` is an
  independent, conceptually-aligned file.

## Testing & Verification

- `cd packages/create-app && node --test --import tsx src/setup/tools/shared.test.ts` (coverage guard + resolver + wizard parsing).
- Manual: `node dist/index.js /tmp/app --skill-packages core,creative` → only core + creative skills + `proposal-intake.md`; `node dist/index.js /tmp/app2` (defaults) → today's set, no `creative`.
- Manual interactive: run the wizard, confirm the package prompt appears for each tool and `core` cannot be deselected.
- `yarn test:create-app` smoke (default scaffold still complete).

## Out of Scope

- Changing the monorepo `install-skills.sh` / `tiers.json` mechanism.
- Per-skill (vs per-package) selection granularity.
- Codex/Cursor-specific skill formats beyond what already ships.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Manifest + coverage guard | Done | 2026-06-15 | `packages.json` + `packages.schema.json`; `shared.test.ts` coverage guards (folder↔package 1:1, default/extraFiles valid, creative opt-in). |
| Phase 2 — generateShared refactor | Done | 2026-06-15 | Pure `resolveSkillSelection` + `loadSkillManifest` + recursive placeholder-safe `copySkillTree`; flat list removed; gated extraFiles. |
| Phase 3 — Wizard + CLI flag | Done | 2026-06-15 | `--skill-packages <csv>` (validated) + `AgenticConfig.skillPackages`; always-shown package prompt; non-TTY/CI degrade to `default`. |
| Phase 4 — Docs + alignment | Done | 2026-06-15 | create-app `AGENTS.md` Skill Packages section; Phase-1 spec cross-ref updated (creative now opt-in). |

### Verification
- `node --test --import tsx 'src/**/*.test.ts'` → 53/53 green (incl. resolver, parsing, manifest coverage guards).
- create-app typecheck clean; `node build.mjs` ok.
- End-to-end scaffolds: defaults → 21 skills, no `creative`; `--skill-packages core,creative` → 13 skills + `proposal-intake.md`, no `automation`; invalid package → error + exit 1; non-TTY without flag → `default` set (no prompt-starvation regression).

### Notes / deviations
- **BC default change (intended):** the default scaffold no longer ships `om-proposal`/`om-brainstorm` (now opt-in `creative`). Phase 1 had shipped them unconditionally but was unreleased, so the change is safe.
- **Non-TTY fix:** adding a second wizard prompt risked starving on EOF under piped stdin; non-interactive runs now resolve packages to the manifest `default` (mirrors the starter-preset / git prompts), so CI and `printf`-driven scaffolds don't regress.
- `migration` kept in `default` to preserve today's shipped set; moving it to opt-in is a possible future refinement.
