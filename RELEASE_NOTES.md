# Release Notes

Deprecations and migration instructions, per the Backward Compatibility contract (see [`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md)). Release history lives in [`CHANGELOG.md`](CHANGELOG.md); this file tracks deprecations and the migrations they require.

## Unreleased

### Deprecated — per-module standalone AI guides → generated fact-sheets

The hand-written per-module standalone guides that shipped into scaffolded apps as `.ai/guides/core.<module>.md` (for the user-facing core modules `auth`, `catalog`, `currencies`, `customer_accounts`, `customers`, `data_sync`, `integrations`, `sales`, `workflows`) are replaced by two layers:

- **Generated per-module fact-sheets** — `.ai/guides/modules/<module>.md` plus a combined `.ai/guides/module-facts.json` sidecar, extracted from module source (entities, events, ACL features, API routes with per-method auth, DI service tokens, searchable entities, host extension tokens, notifications, CLI) at build time.
- **One hand-written conceptual guide** — `.ai/guides/module-system.md`, covering the timeless module-system concepts (anatomy, auto-discovery, naming, mandatory mechanisms, data integrity, migrations).

**Migration:** reference `.ai/guides/modules/<module>.md` for a module's concrete facts and `.ai/guides/module-system.md` for conceptual guidance. For backward compatibility, the legacy `.ai/guides/core.<module>.md` names remain bundled as thin redirect stubs that point at the new fact-sheets for **at least one minor version**; freshly scaffolded apps link only the new paths. The redirect stubs will be removed in a future release.

Spec: [`.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md`](.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md).

### Changed — standalone agentic skills restructured (thin `SKILL.md` + `.ai/agentic.config.json`)

The agentic skills scaffolded into standalone apps (`.ai/skills/<skill>/`) were restructured along a clean separation of concerns:

- **`SKILL.md` is now a thin router** — YAML frontmatter (`name`/`description`, unchanged so auto-discovery still fires), a "when to use" summary, and a reference map. The procedure moved into `instructions.md` (single-flow skills) or `workflow/step-N-*.md` (multi-step), with any subagent playbook in `subagents/<role>.md`. Existing `references/` files are unchanged.
- **The 7 `STANDALONE.md` override files were removed.** Their per-repo behavior is now authored natively into the instructions and driven by a single generated config file, **`.ai/agentic.config.json`** (`{ projectName, agentTools, pr: { baseBranch } }`), which the automated-PR skills read at runtime. The one genuinely per-repo value — the PR base branch — is an install question, exposed non-interactively via the additive CLI flag **`--pr-base <branch|auto>`** (default `auto` → resolve the repo's default branch via `gh` at PR time).

**Migration:** none required for existing apps that keep their current `.ai/skills/`. Re-running `yarn mercato agentic:init` (or scaffolding a new app) regenerates the skills in the new layout and writes `.ai/agentic.config.json`. These are generated scaffold assets, not a published API surface — no code change is required in downstream apps.

Spec: [`.ai/specs/2026-06-27-create-app-agentic-skills-restructure.md`](.ai/specs/2026-06-27-create-app-agentic-skills-restructure.md).
