# Tiered Skills Install

## TLDR

Replace the single directory-level skills symlink with a tiered, per-skill install driven by a JSON manifest. Default install ships only the **core** tier; **automation**, **security**, **migration**, and **infra** tiers are opt-in. Brings loaded skill descriptions back under the harness's 2% context budget without losing any skills, and gives users explicit control over what auto-trigger surface they expose. Issue: [#1744](https://github.com/open-mercato/open-mercato/issues/1744).

## Overview

Open Mercato ships 27 agent skills under `.ai/skills/`. They are exposed to Claude Code and Codex via two directory-level symlinks (`.claude/skills` and `.codex/skills`) created by `scripts/install-skills.sh`. Every skill description is loaded into context on every session so the harness can auto-select skills from triggers — there is no opt-in; every installed skill pays a perpetual context tax.

We have already shortened descriptions in PR-style edits (initial 13,243 → 8,117 chars, ~38% reduction, ds-guardian intentionally left untouched at 785). The harness still reports overflow because the budget is small and the skill count keeps growing. Trimming further hurts auto-selection signal. The structural fix is to stop loading skills the user does not need in this project / this session.

This spec introduces tiered installation so:

- **Daily-driver skills** (code review, design system, build/commit, spec lifecycle) install by default.
- **Workflow-heavy skills** (PR automation, security audits, version-pinned migrations, infra) install only when explicitly requested.
- The single source of truth (`.ai/skills/`) does not move; we change *what gets symlinked into the harness*, not where skills live.

## Problem Statement

1. **Hard ceiling, soft headroom.** Anthropic spec caps each `description:` at 1024 chars. The Claude Code harness additionally caps the *aggregate* descriptions of loaded skills at ~2% of context. With 27 project skills + ~12 globally-installed skills the user already saw `Exceeded skills context budget of 2%. Loaded skill descriptions were truncated by an average of 189 characters per skill.` Truncation degrades auto-selection silently.

2. **Editorial trim is not durable.** Description shortening is a one-shot win. The skill catalog is growing (28+ recent commits to `.ai/skills/`), so the budget will overflow again. We need a structural fix that scales with skill count.

3. **One-shot skills tax every session.** `auto-upgrade-0.4.10-to-0.5.0` and `migrate-mikro-orm` are version-pinned migrations that 99% of sessions never need. `dev-container-maintenance` only matters when editing `.devcontainer/`. They currently consume budget on every session.

4. **No discoverability mechanism for installed-but-unused skills.** A user who needs a security audit today has no list of available-but-uninstalled skills. We need a `--list` surface so opt-in stays discoverable.

## Proposed Solution

Drive skill installation from a single manifest, `.ai/skills/tiers.json`. Rewrite `scripts/install-skills.sh` to:

1. Read tiers.json, accept tier-selection flags.
2. Replace any pre-existing directory-level symlink (`.claude/skills -> ../.ai/skills`) with a real directory.
3. For each skill in the selected tier set, create a per-skill symlink `.claude/skills/<skill> -> ../../.ai/skills/<skill>` (and the same for `.codex/skills/`).
4. Sweep symlinks not in the selected set so re-running with a smaller selection is idempotent.
5. Validate every folder under `.ai/skills/` is assigned to exactly one tier.

We choose a manifest over reorganizing folders into tier subdirectories because:

- Zero risk of breaking external references to skill paths (the Task Router in root `AGENTS.md` cites concrete paths like `.ai/skills/auto-create-pr/SKILL.md`).
- Re-tiering = JSON edit, not `git mv`.
- The manifest is also the source for the README's "Available Skills" table, eliminating drift.

Tier membership is stored in JSON, **not** in `SKILL.md` frontmatter — the Anthropic spec accepts only `name` and `description` (plus optional `compatibility`); adding a custom `tier:` would break validators like `quick_validate.py`.

## Architecture

### Source of truth

`.ai/skills/` remains the canonical location. No skill folders move. Each skill folder still contains exactly the SKILL.md / scripts / references / assets layout it has today.

### Manifest

```
.ai/skills/tiers.json
```

```json
{
  "$schema": "./tiers.schema.json",
  "default": ["core"],
  "tiers": {
    "core": {
      "description": "Daily-driver skills installed by default.",
      "skills": [
        "code-review",
        "ds-guardian",
        "backend-ui-design",
        "check-and-commit",
        "spec-writing",
        "implement-spec",
        "pre-implement-spec",
        "integration-tests",
        "smart-test",
        "create-agents-md",
        "skill-creator",
        "fix-specs"
      ]
    },
    "automation": {
      "description": "PR/issue automation skills. Opt-in; agent-driven workflows.",
      "skills": [
        "auto-create-pr",
        "auto-continue-pr",
        "auto-review-pr",
        "auto-fix-github",
        "review-prs",
        "merge-buddy",
        "sync-merged-pr-issues",
        "auto-update-changelog",
        "auto-qa-scenarios"
      ]
    },
    "security": {
      "description": "Security audit skills. Opt-in.",
      "skills": ["auto-sec-report", "auto-sec-report-pr"]
    },
    "migration": {
      "description": "One-shot, version-pinned migrations. Install only when needed.",
      "skills": ["auto-upgrade-0.4.10-to-0.5.0", "migrate-mikro-orm"]
    },
    "infra": {
      "description": "Rare, special-case skills.",
      "skills": ["dev-container-maintenance", "integration-builder"]
    }
  }
}
```

### Install layout

Before:
```
.claude/skills -> ../.ai/skills          (single symlink to dir)
.codex/skills  -> ../.ai/skills
```

After (default `core` install):
```
.claude/skills/                          (real directory)
  code-review        -> ../../.ai/skills/code-review
  ds-guardian        -> ../../.ai/skills/ds-guardian
  ... (12 core skills)
.codex/skills/                           (real directory)
  ... same 12 symlinks
```

After `yarn install-skills --with automation`:
```
.claude/skills/
  code-review                -> ../../.ai/skills/code-review
  ...
  auto-create-pr             -> ../../.ai/skills/auto-create-pr
  ... (12 core + 9 automation = 21 symlinks)
```

### CLI surface

```bash
yarn install-skills                              # core only (default)
yarn install-skills --with automation            # core + automation
yarn install-skills --with automation,security   # multiple tiers
yarn install-skills --all                        # every tier
yarn install-skills --list                       # show tiers + memberships
yarn install-skills --clean                      # remove all skill symlinks
yarn install-skills --tiers core,security        # explicit tier set (replaces default)
```

`--with` is additive on top of the default. `--tiers` replaces the default. They are mutually exclusive.

### Script behavior

Pseudocode:

```
parse flags  → selected_tiers
manifest     ← read .ai/skills/tiers.json
selected_skills ← union of tiers[t].skills for t in selected_tiers
all_skills      ← every folder under .ai/skills/

# Validation: every folder must be in exactly one tier
unassigned = all_skills - union(every tier.skills)
multi      = folders in >1 tier
fail loudly if unassigned or multi

# Convert legacy directory-level symlink to a real directory
for harness in [.claude, .codex]:
  if harness/skills is a symlink to ../.ai/skills:
    rm harness/skills
  mkdir -p harness/skills

# Install selected
for skill in selected_skills:
  ln -sfn ../../.ai/skills/$skill harness/skills/$skill

# Sweep skills no longer selected
for entry in harness/skills/*:
  if entry is a symlink AND basename(entry) ∉ selected_skills:
    rm entry
```

`--clean` removes all symlinks under `.claude/skills/` and `.codex/skills/` whose targets resolve into `.ai/skills/`, then removes the (now-empty) directories.

`--list` prints:
```
core         (12 skills, default):
  code-review, ds-guardian, ...
automation   (9 skills, opt-in):
  auto-create-pr, auto-continue-pr, ...
...
Currently installed: core, automation (21 skills)
```

## Data Models

### tiers.json schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `default` | `string[]` | yes | Tier names installed when no flags are given. MUST contain `"core"`. |
| `tiers` | `object` | yes | Map of tier name → tier definition. |
| `tiers.<name>.description` | `string` | yes | One-line human-readable description; surfaced by `--list`. |
| `tiers.<name>.skills` | `string[]` | yes | Skill folder names under `.ai/skills/`. Must be unique across all tiers. |

Tier names: `^[a-z][a-z0-9-]*$` (kebab-case). Skill names: must match an existing folder under `.ai/skills/`.

A `tiers.schema.json` JSON Schema lives next to `tiers.json` so editors can validate it.

## API Contracts

This change is **infra-only**. There are no module APIs, database changes, ACL features, or events. The "API" surface is the install script's CLI.

### Backwards-compatible CLI guarantee

| Today | After this spec |
|---|---|
| `yarn install-skills` (no args) installs all 27 skills | `yarn install-skills` (no args) installs core (12) |

This is a behavior change visible to existing users. Mitigation:

1. README clearly documents the change and provides `--all` to reproduce previous behavior.
2. Script prints a one-time hint on first run: "Installed 12 core skills. Run `yarn install-skills --list` to see optional tiers, or `--all` to install every skill."
3. The skills the user *was* relying on are still on disk under `.ai/skills/`. Re-installing additional tiers takes one command; nothing is destroyed.

## Risks & Impact Review

| # | Risk | Severity | Affected Area | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | User runs `yarn install-skills` post-upgrade and silently loses access to `auto-review-pr`, `auto-sec-report`, etc. | Medium | Developer workflow | First-run hint + README upgrade note + CHANGELOG entry. `--all` reproduces old behavior in one command. | Some users hit "skill not found" on first invocation; recoverable in 30s. |
| R2 | Codex symlink resolution differs from Claude Code's | Medium | Codex compatibility | Plan-time spike: prototype with one skill in both harnesses before bulk install. If Codex requires absolute paths, script branches per harness. | Spike may invalidate the per-skill scheme; fallback would be tier-specific umbrella dirs. |
| R3 | New skill added without tier assignment → fails validation → blocks install | Low | DX | Validation prints the unassigned skill name and a hint to add it to `tiers.json`. CI lint can run the validator on PRs touching `.ai/skills/`. | One-line fix for contributor; better than silent drift. |
| R4 | Tier assignment becomes a contested editorial decision | Low | Maintenance | Document tier semantics in README ("core = always-on daily; opt-in = workflow-specific"). Treat re-tiering as a normal PR. | Bikeshedding overhead. |
| R5 | Skill auto-trigger silently fails when user expected it (e.g., `auto-update-changelog` not in core) | Medium | UX | `--list` is discoverable; README's Available Skills table groups by tier. Skill names that hint at automation (the `auto-` prefix) are all in the `automation` tier so the heuristic is teachable. | Education problem; reduces over time. |
| R6 | Stale `.claude/skills` directory left after uninstalling a tier (from old install or interrupted run) | Low | Filesystem hygiene | Sweep step removes symlinks not in the selected set. `--clean` provides nuclear option. | None significant. |
| R7 | Two contributors merge changes to `tiers.json` and a skill folder simultaneously, leaving an unassigned folder | Low | CI | Validator fails the install / CI lint. Post-merge fix is one PR. | Minor. |
| R8 | Tiering encourages unbounded skill growth ("we can always add more, they're opt-in") | Low | Long-term context budget | Treat new optional skills with the same scrutiny as core skills; this spec doesn't relax the description-trim discipline. | Catalog hygiene depends on review culture. |

## Migration & Backward Compatibility

This is **infra not contract surface** — none of the 13 BC contract surfaces from `BACKWARD_COMPATIBILITY.md` apply (no event IDs, no API URLs, no DI keys, no DB schema). The only durable contract is the `yarn install-skills` command name, which is preserved.

Migration steps for an existing checkout:

1. Pull the change.
2. Run `yarn install-skills`. Script detects the old directory-level symlink, removes it, creates `.claude/skills/` (real dir), populates with the 12 core skills.
3. If the user wants automation/security/etc., they re-run with `--with <tier>` or `--all`.

The old behavior (install everything) is one flag away. No skill deletions; nothing under `.ai/skills/` is touched.

## Implementation Plan

Phased so each phase is mergeable.

### Phase 1 — Manifest + validator (small)

- Add `.ai/skills/tiers.json` with the proposed tier assignments.
- Add `.ai/skills/tiers.schema.json` (JSON Schema).
- Add a lightweight validator: a `node`-less shell or `jq` snippet inside `install-skills.sh` that fails if any `.ai/skills/*` folder is unassigned or assigned twice.

**Acceptance:** running the validator against the current checkout returns success; intentionally removing a skill from `tiers.json` makes it fail with a clear message.

### Phase 2 — Rewrite install script

- Rewrite `scripts/install-skills.sh` to read `tiers.json`, accept the flag set defined above, and produce per-skill symlinks.
- Detect and convert legacy directory-level symlinks.
- Implement `--list`, `--clean`, sweep behavior.
- Print one-time install summary: tier counts + hint about optional tiers.

**Acceptance:**
- `yarn install-skills` on a clean checkout produces `.claude/skills/` and `.codex/skills/` containing exactly 12 symlinks, all valid.
- `yarn install-skills --all` produces 27 symlinks.
- `yarn install-skills --with security` after the previous step keeps automation in place if it was already there, or adds security on top of core if not.
- `yarn install-skills --tiers core` after `--all` removes everything except core.
- `yarn install-skills --clean` leaves no symlinks.
- Codex spike: confirm both `claude /skills` and `codex /skills` list the expected set in both default and `--all` modes.

### Phase 3 — README + docs refresh

- Update `.ai/skills/README.md`:
  - New "Tiers" section above "Installation".
  - Available Skills table grouped by tier (auto-derivable from `tiers.json`).
  - Migration note for existing users.
- Add a one-line CHANGELOG entry.

**Acceptance:** README accurately reflects the script's actual behavior; the table matches `tiers.json`.

### Phase 4 — CI lint (optional, follow-up)

- Add a CI check that runs the manifest validator on PRs that touch `.ai/skills/`.

**Acceptance:** opening a PR that adds a skill folder without updating `tiers.json` fails CI with a pointer to this spec.

## Final Compliance Report

| Item | Status | Notes |
|---|---|---|
| Spec naming `{date}-{title}.md` | ✓ | `2026-05-05-tiered-skills-install.md` |
| Required sections present | ✓ | TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks, Migration & BC, Implementation Plan, Compliance Report, Changelog |
| BC contract surfaces touched | None | No events, APIs, DB schema, DI keys, ACL features, or generated file contracts changed; only the `yarn install-skills` CLI default behavior changes — documented under Migration. |
| Integration coverage declared | N/A | Infra-only change with no API or UI surface; manual verification on `claude` and `codex` is the validation path (spike in Phase 2). |
| Task Router relevance | Spec lifecycle (`.ai/specs/AGENTS.md`), skill catalog (`.ai/skills/README.md`), install script (`scripts/install-skills.sh`). |
| Test plan | Manual: clean-checkout install; tier toggle round-trip; `--clean`; legacy-symlink conversion; Codex parity. No unit-test framework runs against `.sh`; behavior is verified by inspecting symlink set after each command. |

## Open Questions

1. ~~**Should `auto-create-pr` / `auto-continue-pr` live in `core` instead of `automation`?**~~ **Resolved 2026-05-05: stay in `automation`.** Keeping the `auto-*` family together is teachable; users who want them on default install can run `yarn install-skills --with automation` once.

2. **Should `migrate-mikro-orm` live in `migration` despite not being version-pinned to a specific Open Mercato release?** It's framework-version-pinned (v6→v7) rather than app-version-pinned. The `migration` semantics are "you only need this once when crossing a version boundary," which fits.

3. **Do we want a `--default` flag** that means "whatever `tiers.json` says is default" so `tiers.json` can evolve the default without flag-name churn? **Default in this spec: yes, `yarn install-skills` with no flags already does this.** No additional flag needed.

## Changelog

| Date | Change |
|---|---|
| 2026-05-05 | Initial draft. Tier assignments proposed; per-skill manifest-driven install scheme. Open questions on `auto-create-pr`/`auto-continue-pr` core membership flagged. |
| 2026-05-05 | Resolved Q1: `auto-create-pr` and `auto-continue-pr` stay in `automation`. Spec is implementation-ready. |
