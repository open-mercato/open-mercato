# Standalone AI Development Harness

- **Status:** Implemented — deterministic and focused remediation gates green; complete multi-runner release certification continues in #4670
- **Date:** 2026-07-24
- **Scope:** OSS, standalone applications emitted by `create-mercato-app` only
- **Tracking plan:** `.ai/runs/2026-07-24-standalone-app-ai-harness.md`
- **Supersedes on acceptance for this scope:** `.ai/specs/2026-06-05-ai-harness-single-shot-optimization.md`, `.ai/specs/2026-06-27-create-app-agentic-skills-restructure.md`, and the unfinished standalone-specific parts of `.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md`

## 📝 TLDR

Replace the AI coding context emitted into a fresh standalone app with one compact task router, progressively loaded task guides and thin local skills, generated installed-module facts, exact-version access to the framework source and its original `AGENTS.md` hierarchy, and an executable evaluation catalog. Keep PR/spec/review automation sourced from `open-mercato/skills`; keep standalone architecture knowledge local and testable. Optimize for real one-shot module/UMES/integration/AI/workflow work and for the bug, security, scoping, concurrency, bootstrap, and contract-drift failures that dominate project history.

## Resolved assumptions (autonomous defaults)

1. **One delivery, independently verifiable slices:** this specification covers the standalone AI development harness as one requested delivery, but its context/router, installer/generator, and evaluation slices have separate acceptance gates and rollback boundaries. A phase may land only while the generated app remains usable and cross-phase compatibility tests stay green.
2. **Standalone boundary:** no monorepo contributor harness or shared skills-collection procedure is rewritten. Shared automation is selected and installed; standalone domain knowledge and overrides remain in create-app assets.
3. **Source-context boundary:** installed framework source and package/module `AGENTS.md` files are read-only reference material. The harness may locate and read them explicitly despite `node_modules` ignore rules, but never edits them.
4. **Evaluation boundary:** deterministic schema/routing/consistency/scaffold gates are CI-authoritative. Read-only Codex/Claude runs evaluate routing only. Writable implementation/regression runs use disposable scaffolds and executable oracles. One explicitly selected primary runner owns every blocking live lane; a different secondary runner may be requested for the representative read-only portability lane without making secondary authentication a prerequisite for an ordinary release.
5. **Migration boundary:** fresh scaffolds get the new layout. `mercato agentic:init` upgrades generated harness assets idempotently without deleting user-authored skills or instructions.

## 📝 Problem Statement

The current standalone harness contains two divergent root instruction files, very large overlapping local skills, stale examples, tool hooks that target obsolete paths, a POSIX-plus-`jq` installer in a Node-based cross-platform app, duplicated generator copy lists, stale built assets, no live-agent evaluation, and no reliable route to exact installed framework context when the summaries are insufficient. This causes excess prompt cost and, more importantly, agents choosing outdated contracts or monorepo-only paths.

## 📝 Proposed Solution

Build a four-layer harness:

1. A boundary-first root `AGENTS.md` that only routes tasks and carries universal safety rules.
2. Focused guides and thin standalone skills loaded only for the selected task.
3. Generated module facts plus an exact installed-source/original-AGENTS escape hatch.
4. A versioned 193-case catalog with deterministic checks, live Codex/Claude routing evaluation, and a skill for adding future cases without bloating the root prompt.

## 📝 Architecture

### Design principles

1. **Route before loading.** Root instructions contain only universal boundaries, a task-family router, validation rules, and pointers. They do not teach full CRUD/UMES/provider procedures.
2. **One knowledge owner.** A contract is stated in one authoritative guide/reference. Other files point to it; a consistency gate rejects duplicate contradictory examples.
3. **Facts from installed code.** Module IDs, APIs/auth, events, ACL features, DI tokens, search entities, notifications, and stable host tokens come from generated facts or the exact installed package source, never a hand-maintained module tutorial.
4. **Skills are routers plus procedures.** Trigger-rich frontmatter stays small; per-branch procedure, templates, and checklists live in `references/` and are loaded only when the chosen path needs them.
5. **Automation is shared; domain context is local.** PR/spec/review/issue skills come from `open-mercato/skills`. Standalone paths, module architecture, provider patterns, and framework-context resolution live in create-app.
6. **Every harness rule earns a case.** A recurring failure becomes a semantic evaluation assertion before it becomes more prose.

### Emitted standalone tree

```text
AGENTS.md                              # small boundary-first router
.ai/
├── agentic.config.json
├── guides/
│   ├── architecture.md             # app/module/auto-discovery and source ownership
│   ├── contracts.md                # scoping, BC IDs, optimistic lock, encryption, commands
│   ├── backend-ui.md               # pages, CrudForm, DataTable, navigation, i18n, DS
│   ├── extensions.md               # UMES mechanism selection and boundaries
│   ├── integrations.md             # provider families and packaging rules
│   ├── ai-workflows.md             # AI agents/tools/orchestrators and workflows
│   ├── testing-debugging.md         # bug taxonomy and smallest validation gates
│   ├── upstream/                    # release-matched root AGENTS + BC snapshots
│   └── modules/<module>.md           # generated installed-module facts
├── skills/
│   ├── tiers.json
│   ├── <local-skill>/SKILL.md       # thin router
│   ├── <local-skill>/references/*  # branch-specific procedure
│   └── <external-skill>/SKILL.md    # narrow repo-local overrides only
├── harness/
│   ├── cases.json                   # versioned use-case catalog
│   ├── cases.schema.json
│   └── result.schema.json
└── qa/...
.agents/skills/                       # canonical installed skill directory
scripts/
├── install-skills.mjs                # cross-platform manifest installer
├── install-skills.sh                 # compatibility wrapper
├── framework-context.mjs             # exact installed-source resolver
└── evaluate-agent-harness.mjs         # deterministic/live evaluation runner
```

### Root instruction contract

The generated `AGENTS.md` MUST:

- use the exact `Always`, `Ask First`, `Never`, and `Validation Commands` boundaries;
- stay at or below 12 KiB and avoid long code examples, leaving substantial headroom under Codex's 32,768-byte default project-instruction budget reported in issue #4484;
- identify the app as a standalone extension layer over read-only installed packages;
- route a task to all matching task families (module/data, UI, UMES, integration, AI/workflows, debugging, spec/PR automation);
- route module-specific analysis to generated facts first and `om-framework-context` only when those facts are insufficient;
- preserve tenant/organization scope, canonical mutation/data helpers, auto-discovery, migrations/snapshots, `yarn generate`, and no-edit rules for generated files/`node_modules`;
- never hard-code a tool-specific skills directory for external skills;
- contain only generated module-fact rows between stable markers so `agentic:init` can replace them idempotently.

The deterministic budget gate measures bytes, not characters. It caps both standalone root sources at 12 KiB and checks representative generated root-only, module/data, UI, integration, and AI initial chains against Codex's 32,768-byte default. It also caps every daily `SKILL.md` router at 120 lines/12 KiB unless explicitly allowlisted with a reason. Each case declares initial routed-context and total-context byte budgets; progressive references and generated module facts are charged to total context rather than the initial bundle. Token estimates and actually accessed bytes are recorded in live results and compared with the checked-in baseline.

The bare `packages/create-app/template/AGENTS.md` becomes the same small safety/router contract with an explicit `agentic:init` fallback when local skills are absent. Agentic setup enriches generated module rows and tool configuration; it does not replace the app's architecture rules with a second conflicting document.

### Local skill catalog

| Skill | When to use | Required reference branches |
|---|---|---|
| `om-help` | Select the smallest workflow/skill for an unfamiliar request. | task families, external automation sequences |
| `om-module-scaffold` | New module or complete entity/CRUD vertical slice. | planning, entity/migration, CRUD/API, ACL/setup, commands/events/search, verification |
| `om-data-model-design` | Entity, relation, sensitive field, migration, snapshot, locking, or atomic-write decisions. | scopes/columns, cross-module links, encryption, migrations, concurrency |
| `om-backend-ui-design` | Backend/frontend/portal pages, forms, tables, navigation, i18n, accessibility, DS. | page types, forms/tables, navigation/overrides, translations, validation |
| `om-system-extension` | UMES enrichers/interceptors/guards/widgets/menus/extensions/events/replacements. | mechanism selector plus one reference per extension family |
| `om-integration-builder` | Email, shipping, payment, data-sync, webhook, storage, or other provider integration. | provider selection, package/adapter, credentials/security, reliability, activation/tests |
| `om-create-ai-agent` | Typed module AI agent/tool/UI part/orchestrator/subagent work. | agent/tool contracts, mutation approval, orchestrator files, attachments/artifacts, overrides |
| `om-build-workflow` | Workflow activities, triggers, durable user tasks, outputs, idempotency, progress. | activity contracts, transaction/idempotency, events/UI, testing |
| `om-troubleshooter` | Bug diagnosis and minimal verified repair. | generator/bootstrap, data integrity/scope, UI/hydration, cache/search, provider reliability |
| `om-framework-context` | Generated facts are insufficient and the exact installed framework implementation/AGENTS hierarchy is needed. | resolver procedure, narrow source search, version/skew report, upstream-report boundary |
| `om-evolve-harness` | Add a new harness use case or correct a failed routing/implementation pattern. | case capture/schema, owner selection, affected-case calculation, before/after eval |
| `om-eject-and-customize` | UMES/overrides cannot provide the required behavior and an installed module must be copied into app source. | decision gate, eject procedure, upgrade ownership |
| `om-implement-spec` | Implement selected standalone spec phases without PR automation. | phase orchestration, subagent boundaries, progress, review/test gates |
| `om-trim-unused-modules` | Disable unused built-ins after dependency analysis. | dependency analysis, modules.ts edit, generation/cache validation |

Existing public local skill names remain available. Their old monolithic bodies are replaced, not aliased to stale content. Version-specific upgrade skills remain opt-in and are not part of the daily routing surface.

### Shared skill selection

The default external source remains `open-mercato/skills`, pinned to a tested commit in `tiers.json`; the installer CLI is pinned independently. Install the smallest dependency-closed set needed for daily standalone delivery:

- authoring/review: `om-spec-writing`, `om-code-review`, `om-integration-tests`, `om-prepare-test-env`;
- one-shot/resumable PR delivery: `om-auto-create-pr`, `om-auto-continue-pr`, `om-auto-review-pr`, `om-auto-implement-spec`, `om-auto-qa-pr`;
- issue autofix chain: `om-auto-fix-issue`, `om-verify-in-repo`, `om-root-cause`, `om-fix`, `om-open-pr`;
- pipeline maintenance: `om-setup-agent-pipeline`.

The loop engines, issue authoring/management, and upgrade-note workflow are opt-in because their full dependency closure is not required for daily delivery. `external.tiers.core` owns the 15-skill daily set; `external.tiers.automation` owns those five advanced entry points, selected with the same `--with automation`, `--tiers automation`, or `--all` contract as local tiers. Dependency closure is computed before installation, so an exact opt-in tier still receives every prerequisite. The manifest MUST encode and test the hard dependency closure rather than keeping that graph only in test code. It records the tested collection commit and resolved per-skill content hashes; ordinary re-runs never update to collection HEAD. External skills never also appear in a local tier. A same-name local folder is an override and is never linked over the installed skill.

### Exact installed framework context escape hatch

Published `@open-mercato/*` packages already carry their TypeScript `src/` trees and their package/module `AGENTS.md` files. Generic search misses them because `node_modules` is ignored. `scripts/framework-context.mjs` and `om-framework-context` turn that latent context into an explicit, narrow, version-correct path:

1. Resolve a requested module from the app root using Node package resolution for the packages declared by `src/modules.ts`; only then inspect that resolved package's `src/modules/<module>` tree. Do not select an arbitrary hoisted/transitive duplicate.
2. Read the installed package version and source root.
3. Return the instruction chain and its concern-specific precedence: standalone root wins for safety, ownership, and writable paths; the BC snapshot wins for frozen public identifiers; the nearest installed package/module `AGENTS.md` wins for version-specific framework contracts; the upstream root snapshot is contextual only. An unresolved contradiction is a hard diagnostic, not an invitation to guess.
4. Return exact source paths and a bounded search command using `rg --no-ignore --hidden` scoped to that package/module; never run an unbounded `node_modules` search.
5. Reject stale generated facts when their stamped package version does not match the package resolved from the app root. Report duplicate versions and snapshot skew; never silently combine them.
6. If a package omits `src/`, degrade to `dist/` plus type declarations and state that source-level analysis is limited. Network fetching is an explicit fallback, never the default.
7. Treat all upstream content as read-only. A required framework change becomes an upstream issue/PR or an explicit eject decision; the standalone task never patches `node_modules`.

`packages/create-app/build.mjs` snapshots the repository root `AGENTS.md` and `BACKWARD_COMPATIBILITY.md` into the built agentic assets. `packages/cli` already republishes those create-app agentic assets, so the resolver can read a release-matched snapshot from installed `@open-mercato/cli` after the npx scaffold process is gone.

### Installer contract

Replace the generated installer's shell implementation with a Node 24 script while preserving the `yarn install-skills` command and existing flags:

- `--with`, `--tiers`, `--all`, `--list`, `--clean`, `--legacy-links`, `--ignore-agents`, `--no-external`;
- `OM_SKIP_EXTERNAL_SKILLS=1` offline behavior;
- canonical `.agents/skills/<name>` ownership;
- Claude compatibility links only by default; Codex/Cursor use `.agents/skills` directly;
- safe migration/sweeping of legacy directory-level or per-agent links;
- external install before local links, because the external CLI owns the canonical directory; stage and verify the complete selected dependency-closed set, retain every previous destination as a backup, activate all selected skills, and publish the ownership ledger only after the whole set succeeds; any failure restores the complete prior set before the non-fatal local-only continuation;
- repeated `--skill <name>` arguments (never a comma-packed wildcard);
- a pinned `skills` CLI version plus explicit `open-mercato/skills` commit stored in the manifest;
- process spawning with argument arrays and Windows-aware executable resolution;
- no `jq`, POSIX shell, interactive prompt, or git-checkout requirement;
- non-fatal external network failure after local skills are installed, with a clear retry command;
- `install-skills.sh` retained as a small compatibility wrapper for existing direct callers.

Every generated call site uses Node directly: the package script, create-app wizard, and CLI `agentic:init` invoke `process.execPath` with `scripts/install-skills.mjs`. The bare template ships a successful Node placeholder before agentic setup. The compatibility shell wrapper is never on an automatic Windows path.

### Generator and ownership contract

- `packages/create-app/agentic/` remains the single source for standalone harness assets.
- The create-app wizard and `packages/cli` `agentic:init` MUST use the same recursive text-aware copy contract; hard-coded per-skill file lists are removed.
- The common mapping is `shared/AGENTS.md.template` → `AGENTS.md`, `shared/ai/**` → `.ai/**`, and `shared/scripts/**` → `scripts/**`; files are traversed in deterministic order. Placeholder substitution applies to an explicit text-extension allowlist, while binary assets are copied byte-for-byte with safe modes.
- Re-running setup replaces only generated marker blocks and known generated assets. It never deletes an unknown/user-authored `.ai/skills/*` directory.
- `build.mjs` clears `dist/agentic` before copying to prevent deleted skills or legacy `STANDALONE.md` files from shipping.
- Both create-app and CLI builds independently clear and repopulate their output `agentic` trees and write version/source-hashed upstream root/BC snapshots; neither assumes it is copying the other's already-built output.
- A generated manifest records the owned file set and source hash so upgrades can distinguish unmodified generated assets from user modifications.
- Tool-specific files add enforcement/hook behavior only. They do not restate the architecture. Entity hooks/globs target `src/modules/*/data/entities.ts`.
- Module facts add `sourcePackage` and `sourceVersion` while retaining the existing `coreVersion` field as a compatibility bridge. A valid empty enabled-module intersection remains empty; only an actual `src/modules.ts` parse failure may fall back to all bundled facts.
- The generated module marker is an identifier-only enabled-module index plus one `.ai/guides/modules/<id>.md` loading rule. It never embeds module descriptions or repeats one fact-sheet path per module; detailed facts remain progressively loaded from the named/targeted module sheet.

The manifest is finalized atomically only after shared emission, module-row injection, tool patching, and persisted agent selection. Relative paths are normalized and rejected if they escape the app root. Rerun behavior is explicit:

| Existing state | Default setup | `--update-harness` | `--force` |
|---|---|---|---|
| Owned and hash unchanged | Existing-file warning and no-op. | Replace/update and refresh hash. | Replace. |
| Owned but user-modified | Existing-file warning and no-op. | Preserve; write an adjacent `.incoming` candidate and report conflict. | Replace. |
| Unknown/user-authored | Preserve. | Preserve; an exact-path collision gets `.incoming`. | Preserve unless it is an exact generated target. |
| Missing prior owned file | Existing-file policy applies to the selected tool. | Recreate if still emitted. | Recreate. |
| Missing/corrupt manifest | Existing-file policy applies. | Treat existing targets as unknown, preserve them, and emit `.incoming`; add missing targets. | Replace exact generated targets, never unrelated unknown files. |

`agentic:init --tool` and `--force` keep their existing meaning and default no-force early-exit behavior. The additive `--update-harness` path performs the ownership-aware upgrade. Candidate generation and validation happen in staging; every managed source and destination is resolved below a canonical root and every existing ancestor is checked with `lstat`, so `.ai`/`.agents` or a deeper managed ancestor cannot redirect a write through a symlink. The manifest is renamed atomically only after file publication succeeds. External skill installation runs afterward as a separate, non-fatal phase, so an offline registry does not invalidate the emitted harness manifest.

## 📝 Data Model

This feature adds no runtime database model. It defines versioned JSON contracts for catalog cases, validator/release matrices, generated ownership, routing/review responses, writable/target-validation evidence, and sanitized release results.

### Harness case record

Each object in `.ai/harness/cases.json` contains:

```ts
type HarnessCase = {
  id: string
  title: string
  family: 'architecture' | 'module' | 'umes' | 'integration' | 'ai-workflow' | 'bugfix' | 'business' | 'testing'
  mode: 'analysis' | 'one-shot' | 'spec' | 'bugfix' | 'review'
  evaluationKind: 'static' | 'routing' | 'implementation' | 'regression'
  risk: 'low' | 'medium' | 'high'
  prompt: string
  tags: string[]
  owner: { kind: 'root' | 'guide' | 'skill' | 'facts' | 'hook'; path: string; ruleIds: string[] }
  expectedRouter: { required: string[]; allowedExtra?: string[] }
  requiredSkills: string[]
  optionalSkills?: Array<{ id: string; route: string }>
  context: { required: string[]; allowedExtra?: string[]; forbidden: string[] }
  requiredDecisions: string[]
  forbiddenPatterns: string[]
  validators: string[]
  fixture?: { scaffold: string; setup: string[]; expectedFailure?: string }
  oracle?: { validatorIds: string[]; expectedArtifacts?: string[] }
  allowedWrites?: string[]
  maxContextFiles: number
  maxInitialContextBytes: number
  maxTotalContextBytes: number
  relatedCases: string[]
  source?: { prs?: string[]; paths?: string[] }
}
```

Router matching uses required-subset semantics; `allowedExtra` caps permitted extra routes. Context paths use app-relative exact paths or explicit globs. Validators are IDs from a checked-in registry and never arbitrary shell copied from evidence. Static checks observe files directly; live routing checks record actual tool/file access separately from model-reported selections. Both live CLIs disable general shell/process/environment/discovery/browser/network tools and expose only an evaluator-owned MCP server launched through `env -i`, with exact-path reads and case-allowlisted atomic writes. Its root/path checks keep isolated runner credentials and arbitrary outbound access outside the model tool boundary. The schema rejects unknown families/modes, duplicate IDs, missing owners/rule IDs, dangling related-case IDs, missing skill/guide files, unknown validator IDs, unsafe setup commands, and impossible context budgets. Live results record schema version, case ID and prompt hash, tool/version/model, actual selected context, decisions, violations, duration, exit status, and pass/fail. They redact environment values, credentials, tokens, home paths, and private prompt bodies.

### Generated harness ownership manifest

`.ai/harness/manifest.json` records harness version, generator package version, emitted relative paths, content hashes, source kind (`generated`, `local-skill`, `external-override`), and whether a file may be user-edited. Regeneration follows the ownership state table above; no directory name alone establishes ownership.

## 📝 API Contracts

No HTTP API is added. The generated script interfaces are stable CLI contracts:

```text
yarn install-skills [existing flags]
yarn framework:context --module <id> [--query <text>] [--json]
yarn framework:context --package <@scope/name> [--query <text>] [--json]
yarn harness:validate [--case <id> | --family <name> | --all]
yarn harness:validate --runner <codex|claude> [--case/--family/--all] [--batch-size <n>] [--timeout <ms>]
yarn harness:fixture --case <id> --target <absolute-disposable-app> --acknowledge-writes
yarn harness:validate --runner <codex|claude> --case <id> --writable-root <absolute-disposable-app> --acknowledge-writes
yarn harness:validate --runner <codex|claude> --review-writable-result <result.json> --writable-root <absolute-disposable-app> [--review-validation-result <result.json>]
yarn harness:release --runner <codex|claude> [--portability-runner <other-runner>] --prepare-targets <absolute-empty-directory> --acknowledge-writes
yarn mercato agentic:init [--tool <id>] [--update-harness | --force]
```

All commands default to read-only behavior. Routing evaluation runs inside a mandatory controller-owned host sandbox with only the selected app and isolated runner/output state mounted. Codex uses schema output and a permissive inner tool sandbox because nested macOS Seatbelt profiles cannot reliably read the already-contained app; the outer sandbox is the filesystem authority. Claude additionally uses plan permission mode, read-only tools, structured output, and no session persistence. Every case receives a fresh session (batching is orchestration only). Implementation/regression evaluation requires an explicitly disposable scaffold; the outer sandbox and post-run fingerprints restrict writes to `allowedWrites`. macOS `sandbox-exec` is supported for network-free lanes but shares the host network namespace, so the complete release command—which includes Playwright loopback lanes—requires Linux with Bubblewrap and user namespaces. Unsupported-host preflight exits before target preparation, provider invocation, or writable execution. Exit codes are `0` pass, `1` evaluated failure, and `2` invalid invocation/environment; timeouts/non-zero agent exits are failures with partial sanitized results. Results go under ignored `.ai/harness/results/`.

## 📝 UI/UX

No product UI changes. Developer-visible output follows these rules:

- context resolution prints the installed package version, ordered instruction chain, exact source root, bounded search command, and any skew warning;
- deterministic evaluation prints pass/fail per case and a concise owner/path explanation;
- live evaluation prints tool/model/version, case totals, failures, and the result artifact path;
- the installer prints selected local tiers, external result, canonical layout, and recovery command without exposing tokens or environment values.

## Optimization and Evaluation Use Cases

Every case is evaluated against a fresh standalone scaffold. Cases 57–70 are mandatory security/data-integrity regressions on every harness-affecting change; other cases run by affected router/skill/contract tags, with the full set at release time.

### Architecture, discovery, and planning

1. Explain the installed application architecture and enabled-module capabilities without assuming monorepo paths.
2. Decide between a new app module, UMES extension, module override, package installation, and eject-and-customize.
3. Locate an installed module's canonical entities, events, ACL, APIs/auth, DI, search entities, and widget host tokens.
4. Produce a one-shot library-management module plan using canonical framework primitives.
5. Split a large brief into cohesive specs only where capabilities are independently deployable.
6. Implement selected spec phases while leaving the app working after every phase.
7. Audit an app after a framework upgrade for stale imports, payloads, facts, migrations, and generated registries.
8. Analyze and safely disable unused built-in modules without breaking dependencies.

### Complete custom-module vertical slices

9. Add an editable entity with tenant/org scope, `updated_at`, validators, migration, snapshot, and optimistic locking.
10. Add related entities without direct cross-module ORM relationships.
11. Build list/detail/create/update/delete using `makeCrudRoute`, metadata, OpenAPI, indexer, and scoped responses.
12. Add a non-CRUD action endpoint using commands, mutation guards, optimistic locking, events, and undo where applicable.
13. Declare ACL features/dependencies, default role grants, and sync existing tenants.
14. Build backend list/create/edit/detail pages with `DataTable`, `CrudForm`, states, stable IDs, and conflict surfacing.
15. Add a public frontend page through auto-discovery.
16. Add a customer-portal page with `[orgSlug]`, customer auth/features, and portal navigation.
17. Configure full-text/token/vector search and verify reindex behavior.
18. Add typed events plus synchronous and asynchronous idempotent subscribers.
19. Add an idempotent explicitly tenant-wide scheduler worker with retry/concurrency/progress while preserving the installed nullable-organization contract and isolating organization-owned data.
20. Add notification types, renderers, and reactive client handlers.
21. Add tenant-tagged cache reads and write-path invalidation.
22. Add a module CLI command that works from published compiled packages.
23. Add module translations and reject user-facing hard-coded strings.
24. Add custom fields/custom entities with API/UI save-reload-clear round-trip coverage.

### UMES and app customization

25. Add a scoped response enricher with `enrichOne` and batched `enrichMany`.
26. Add an editable core `CrudForm` field using widget, read/enricher, and save/interceptor paths.
27. Add a DataTable column, filter, row action, bulk action, or toolbar item using stable host tokens.
28. Add or reorder main/settings/profile/topbar menu items.
29. Hide or replace an installed page through supported overrides without deleting framework code.
30. Replace, wrap, or transform props of an installed UI component.
31. Intercept an installed API request/response while preserving auth, scope, and body/query contracts.
32. Add a mutation guard that blocks or rewrites payloads and runs safe post-success callbacks.
33. Extend an installed data model through an extension entity/FK link.
34. React to a lifecycle event and degrade safely when an optional host module is absent.
35. Add DOM Event Bridge/SSE progress to a long-running operation.
36. Add a reactive notification side effect.
37. Gate an injected widget/page/menu with ACL including wildcard grants.
38. Add a feature toggle that hides UI and consistently blocks/degrades backend behavior.

### Integrations and providers

39. Build an app-local email integration with encrypted credentials, connection test, health, retry, and logs; do not invent a workspace, and branch to a separately published package only when reuse is explicit.
40. Build a shipping/carrier method using the provider package pattern.
41. Build a payment gateway with idempotent/concurrency-safe sessions, redacted errors, and versioned adapters.
42. Build a Magento-like `DataSyncAdapter` package with DI, settings UI, mappings, health, presets, and rerun idempotency.
43. Add inbound/outbound webhooks with signatures, scope, replay protection, queues, and delivery status.
44. Add CSV/XML/JSON import-export with streaming, cleanup, formula neutralization, and row error isolation.
45. Add an external REST client with SSRF-safe URLs, rate limits, retries, pagination, cursor safety, and reconciliation.
46. Package a provider with correct workspace, exports, peer versions, build/prepack, activation, and published-path tests.
47. Handle live provider variants such as global versus website price scope.
48. Safely defer/remove a provider phase superseded by a newer installed module.

### AI agents and workflows

49. Create a typed module AI agent with provider/model configuration and generated registration.
50. Add an AI tool with approval-gated mutations, ACL, scope, and attachments.
51. Add an orchestrator file agent with `AGENT.md`, outcome/sample contracts, embedded skill, and subagent.
52. Add attachments-in/artifacts-out storage with encryption, authorization, cleanup, and download routes.
53. Add a code workflow with stable activity output paths and secure durable user tasks.
54. Add a `CALL_API` activity whose one-time/idempotency key survives transaction rollback.
55. Add live agent/workflow progress through events and widgets.
56. Override or disable an installed agent/tool through supported module overrides.

### High-frequency bug-fix and safety cases

57. Fail closed when tenant or organization context is null/missing.
58. Support all-organizations mode without a 401 refresh loop or scope widening.
59. Reject malformed ID-list filters instead of interpreting them as no filter.
60. Make a multi-phase write atomic so injected failure leaves no partial state.
61. Fix an editable field that does not survive save/reload or cannot clear to `null`.
62. Add optimistic concurrency to a raw update/delete UI flow.
63. Restore cache invalidation after a command or sub-resource mutation.
64. Fix behavior that differs across browser, CLI, worker, and queue bootstraps.
65. Replace chunk-fragile singletons/`instanceof` assumptions with global registries/type guards.
66. Replace write-then-search sleeps with deterministic convergence polling.
67. Fix server/client locale or environment hydration mismatch.
68. Align detail/PDF/export route ACL to eliminate an under-gated alternate path.
69. Preserve mode/status invariants through retry, reconciliation, undo, and recovery.
70. Ensure transient external-page failure cannot advance a cursor or lose a page.

### Business one-shot applications

71. Deliver customer/contact management by using the installed CRM identity and extending it rather than cloning it.
72. Customize the installed customers deal pipeline with tenant stages, policies, UI, ACL, and conflict handling.
73. Generate a localized public lead-capture app with consent, deduplication, qualification, and retry-safe CRM handoff.
74. Add customer-success health, ownership, renewal, tasks, notifications, and durable escalation to CRM.
75. Build a scoped, currency-aware sales forecast and deal-coaching dashboard.
76. Add customer-specific catalog assortments and exact price lists with deterministic precedence.
77. Add quote approval and exactly-once approved-quote conversion into orders.
78. Build returns/RMA across orders, catalog, customers, portal, notifications, and guarded refunds.
79. Build exact payment reconciliation, exception retention, dispute management, and progress reporting.
80. Build provider-neutral carrier selection, retry-safe booking, labels, and fulfillment convergence.
81. Let portal customers view orders and approve eligible quotes under principal-derived scope.
82. Synchronize CRM customers and catalog products with an ERP through a resumable DataSync provider.

### Test authoring and execution

83. Write and run focused unit tests for command success, denial, scope, conflict, atomic failure, and retry invariants.
84. Build and run self-contained CRUD API integration tests with API fixtures and `finally` cleanup.
85. Build and run self-contained browser integration coverage for a portal flow without demo data or sleeps.
86. Run generation and the smallest affected unit/integration tests first, then the configured broad validation tail.

### Full surface, frontend, design-system, and UX audits

87. Map a complex module brief to every current canonical discovery/support surface, including vector and UI locale files, and reject retired conventions/placeholders.
88. Select every additive UMES mechanism, including query enrichers/sync subscribers, reactive/DOM/client filters, integration UI, vector, embedded AI, and typed provider registrations.
89. Audit all wired `entry.overrides` domains plus additive AI extensions, resolved registry/worker keys, entry-scoped setup, disable/replace semantics, and rollback.
90. Build a responsive localized public frontend over installed catalog capabilities with server-first boundaries.
91. Extend the customer portal with public/guarded metadata, principal-derived scope, frozen extension identifiers, navigation, shared UI, and full UX states.
92. Redesign a dense operations page for exact Alert/confirm/form contracts, status/tag and brand rules, responsive UX, accessibility, and state coverage.

### Customer and CRM operations

93. Merge duplicate contacts without losing customer history.
94. Organize companies into parent groups without circular hierarchies.
95. Record customer consent acceptance and withdrawal by purpose.
96. Assign customer territories with a recorded manual override.
97. Start a customer onboarding checklist after a deal is won.
98. Explain customer health using orders, cases, and tasks.
99. Send renewal reminders once in each notification window.
100. Show one authorized timeline of customer activity.
101. Save reusable customer segments with predictable membership.
102. Attribute campaigns without trusting hidden form values.
103. Transfer many customers to a new owner safely.
104. Preview customer spreadsheet imports and return row errors.
105. Customize deal stages while blocking invalid stage jumps.
106. Assign leads fairly with an explainable round robin.

### Sales and revenue operations

107. Require approval when a quote discount is too large.
108. Keep quote revisions immutable and accept only the current one.
109. Turn an accepted recurring quote into renewal orders once.
110. Split an order into shipments without changing totals.
111. Allocate backorders predictably without overselling stock.
112. Exchange a returned item through linked replacement states.
113. Calculate commission after payment using the historic rate.
114. Forecast in a reporting currency without rewriting history.
115. Make the deal board usable by keyboard touch and screen reader.
116. Send one alert when a deal has been inactive for ten days.

### Catalog, inventory, and purchasing

117. Build product bundles whose components control availability.
118. Create size and color variants without duplicate SKUs.
119. Apply customer price lists with a clear fallback.
120. Apply promotion stacking exclusions and priority predictably.
121. Track stock per warehouse through an immutable movement history.
122. Reserve the last item atomically during concurrent checkout.
123. Manage supplier purchase orders dates and approvals.
124. Receive purchase orders partially and record discrepancies.
125. Create nightly reorder suggestions without duplicates.
126. Trace lots expiry dates and recalls through stock movements.
127. Search products by words SKU and scoped filters.
128. Update thousands of prices with progress cancel and undo.
129. Build fast shareable product filters for phone and desktop.

### Portal and operator UX

130. Turn a public demo request into one safe CRM lead.
131. Let portal users edit only their own contact details.
132. Protect portal invoice downloads exactly like their order.
133. Approve only the latest quote from the customer portal.
134. Hide an admin screen and menu without editing installed code.
135. Support long Polish and German copy dates money and errors.
136. Redesign a dense warehouse dashboard for phone and desktop.
137. Create an accessible setup wizard that can resume later.
138. Make order editing understandable on an unreliable connection.

### Plain-language workflows and embedded AI

139. Require manager approval before staff can sell to a high-risk customer.
140. Send overdue invoice reminders and stop immediately after payment.
141. Coordinate picking packing dispatch and manual fulfilment exceptions.
142. Run annual renewals at each customer's local time without duplicates.
143. Add a read-only assistant that scores leads and explains the evidence.
144. Draft quotes with an assistant while requiring approval for every saved change.
145. Create draft product descriptions from authorized supplier files.
146. Coordinate sales questions through specialized product and stock assistants.
147. Replace the sales assistant for one account and let administrators disable it.
148. Show live assistant-job progress with safe cancellation and resume.

### Integration and provider operations

149. Send transactional email through an SMTP service with a safe connection test.
150. Take card payments without charging twice when a request is retried.
151. Compare carrier rates buy labels and reconcile tracking updates.
152. Calculate tax through an external service with an explicit outage policy.
153. Synchronize customers products and orders with an ERP and show progress.
154. Accept signed partner updates without replaying or duplicating changes.
155. Notify a partner after shipment with retries and visible delivery status.
156. Import and export products without one bad row stopping the file.
157. Store customer attachments with short-lived authorized download links.
158. Refresh OAuth credentials safely when several jobs run together.
159. Resume a rate-limited GraphQL import after temporary page failures.
160. Preserve global and store-specific marketplace pricing modes.
161. Package a connector so several standalone applications can install it.
162. Remove a custom connector phase now supplied by the installed application.

### Testing, planning, and delivery workflows

163. Test quote approval rules and failure paths with focused unit tests.
164. Test the customer API through success denial conflict and cleanup.
165. Test portal order viewing and quote approval in a real browser.
166. Test a payment connector without contacting the real payment company.
167. Turn a library-management idea into independently deliverable stages.
168. Implement selected purchasing-plan stages while keeping the application working.
169. Build test commit and open a ready pull request for demo requests.
170. Review a stock-reservation pull request for actionable problems only.

### Regressions, review, UMES, and harness evolution

171. Fix customer search results leaking between companies and prove isolation.
172. Fix a cleared optional customer field returning after refresh.
173. Fix retried delivery callbacks creating duplicate shipments.
174. Fix an ERP synchronization job skipping records after a page failure.
175. Fix dates changing after hydration when browser and server languages differ.
176. Review an inaccessible order dialog with hidden errors and raw colors.
177. Choose the smallest safe design for customer loyalty tiers.
178. Locate exact installed order-confirmation surfaces before changing behavior.
179. Show loyalty points in customer responses without copying customer records.
180. Add preferred contact time to the existing customer form with full round trip.
181. Add an order-risk filter and safe bulk review action to the orders table.
182. Block order cancellation after dispatch across every entry point.
183. Award loyalty points after payment while tolerating an absent sales feature.
184. Add a repeatable harness case for misplaced supplier scorecard work.
185. Create a complete searchable and extensible book-library module in one shot.
186. Add a scoped cache-aside read with complete post-commit invalidation.
187. Add a durable module queue with an auto-discovered retry-safe worker.
188. Prevent overlapping reservations while allowing boundary-touching room bookings.
189. Harden a calendar integration provider with tenant-safe credentials and retries.
190. Add a dotted-ID response enricher without coupling the contributing module.
191. Keep delayed workflow holds durable through timer and confirmation races.
192. Build a scoped CRM-linked library with reversible commands, atomic checkout, and executable unit tests.
193. Build the OMH-185 complete library outcome from business language while inferring canonical CRUD, safety, search, localization, and extension choices from routed guidance.

### Evaluation levels and release matrix

All 193 cases have a deterministic catalog/owner/reference/budget check and a read-only routing assertion. That proves the correct context was selected; it does not claim that model-authored code works. The writable release target is 46 representative cases (23.8% of the catalog). A case counts toward that target only after its release-matrix entry, disposable fixture, controller-owned oracle, and narrow write allowlist land together; catalog classification alone does not make a case executable.

Executable coverage is distributed across these slices; the release matrix and trusted oracles must remain aligned for all 46 cases:

- module vertical slice: 9, 11, 12, 14;
- extension/UI: 26, 27, 29, 31;
- integration/AI/workflow: 42, 45, 49, 54;
- seeded regression fixtures: 57, 60, 61, 70;
- business command and workflow slices: 93, 105, 107, 122, 128, 133, 140;
- business UI and portal slices: 115, 130, 137, 165, 181;
- business AI and provider slices: 144, 146, 149, 150, 151, 153, 156;
- business test-authoring slices: 163, 164, 165;
- business regressions: 171, 172;
- complete standalone module: 185;
- field-tested generative regressions: 188, 189, 190, 191, 192.

Implementation cases use a fresh disposable scaffold, explicit allowed-write paths, deterministic fixture setup, expected artifacts, and executable validator IDs. A fixed controller-owned TypeScript AST oracle covers every registered writable case and rejects comment/import token stuffing; isolated mocked behavior probes additionally exercise provider/workflow effects and seeded regressions. The target cannot replace executable oracle code. The after phase also runs the target's fixed `yarn typecheck` gate. Every target command, including `yarn build`, runs with network mode `none`. Regression cases must fail their oracle before the agent change and pass it afterward. Provider cases use mocked effects or contract servers unless explicit test credentials are supplied. Broad cases may use parameterized variants, but each variant has a distinct result and oracle.

All 46 writable implementation and regression cases must pass an isolated generated-code review after their trusted oracle, target commands, and any declared generated-test execution pass. The evaluator binds review to those attestations and the final whole-target fingerprint, then copies changed regular text files as line-numbered inert snapshots, plus the controller-installed pinned `om-code-review` skill, a static review policy, controller oracle evidence, and UI/design-system references only for UI-routed cases into a bounded temporary read-only bundle. Target scripts, dependencies, Git/tracker state, original executable source files, and the target's absolute path are not copied or supplied. Trace-verified out-of-bundle, environment, or process inspection and any bundle/target mutation fail closed. A separate sanitized review artifact records the source-result, target, skill, policy, command and generated-test attestations, and final-fingerprint hashes plus the strict report/findings/verdict; this supplemental gate does not claim the skill's full repository validation gate or CI passed.

Cases 163, 164, 165, and 192 are executable test-authoring evaluations. They produce focused Jest unit tests, a Playwright API integration test over real contained loopback HTTP, and a Playwright browser integration test. Their files live in canonical module-local `__tests__` or `__integration__` paths and must be executed by fixed controller-owned argv inside the writable sandbox. Jest files must import their globals explicitly when the target TypeScript configuration does not provide them. AST or mocked-helper inspection is not test-execution evidence. Playwright execution is supported only on Linux with Bubblewrap: its unshared network namespace makes case-local loopback available without exposing host-loopback services. macOS `sandbox-exec` cannot provide this boundary. External network, Docker sockets, host test credentials, and inherited application/database environment values remain unavailable; missing test/browser containment prerequisites fail the release lane.

The checked-in `releaseMatrix` pins supported runner model selectors plus required and portability case IDs. The release invocation pins one primary runner for the whole suite; per-case fallback or mixed writable ownership is forbidden. Acceptance for this PR is:

1. deterministic validation: 193/193 pass, including 100% forbidden/safety assertions;
2. selected primary-runner routing: 193/193 pass with one fresh-process correction allowed only for correctable read-only routing assertions, in addition to the bounded invalid-output/transient retry;
3. optional portability routing: when a different `--portability-runner` is explicitly requested, the exact 46-case representative target passes with the same retry rule; when omitted, the release report records `portabilityRunner: null` and does not claim cross-model evidence;
4. writable implementation/regression: the selected primary runner owns all 46 cases, and every target oracle, fixed target command, declared generated test, and mandatory generated-code review passes;
5. results are produced from the final commit, record CLI/model versions and prompt hashes, and are summarized without committing raw private transcripts.

Primary-runner unavailability blocks claiming live release evidence; it does not invalidate deterministic CI. An unrequested secondary runner is not a release prerequisite. Once the portability lane is explicitly requested, its failures or unavailability fail that extended run. Primary runner, safety, forbidden-pattern, executable-oracle, validation, generated-test, and generated-code-review failures remain non-waivable. No score averaging hides a failed mandatory case.

### Backward-compatibility semantic coverage

The case assertions cover every frozen/stable surface even though the harness does not modify the runtime contracts: auto-discovery conventions; additive type/function changes; public import paths; event, widget spot, API route, DI, ACL, notification, and AI IDs; additive database schema; stable CLI commands/flags; and unchanged `.mercato/generated` bootstrap exports. Rename/removal prompts must route to deprecation/bridge/migration guidance. The setup smoke records the `.mercato/generated` export set before and after harness initialization and requires equivalence.

## Harness Evolution Workflow

`om-evolve-harness` makes new cases structured and repeatable:

1. Capture the failing prompt/transcript or source PR as untrusted evidence.
2. Classify and deduplicate it against case families/tags.
3. Reproduce it in a fresh scaffold pinned to explicit create-app/framework/agent versions.
4. Reduce the failure to semantic assertions rather than whole-file golden output.
5. Select exactly one smallest knowledge owner: root invariant, router row, conceptual guide, local skill reference, generated-fact extractor, external override/config, installer closure, or tool hook.
6. Run the new case before the edit and save the failure summary.
7. Update that owner only; references point to it instead of duplicating the rule.
8. Re-run the target case, related tagged cases, mandatory safety cases, context-budget gate, and scaffold smoke.
9. Register case metadata and update coverage/changelog.
10. Report before/after evidence with exact agent and installed framework versions.

## 📝 Edge Cases & Failure Scenarios

- **Agentic setup skipped:** the fallback root remains safe and explains `yarn mercato agentic:init`; `yarn install-skills` placeholder remains actionable.
- **Offline external install:** local skills install and work; external status is a warning with a retry command.
- **Missing `jq`/POSIX shell/Windows:** Node installer works using built-ins; the shell wrapper is optional compatibility only.
- **Symlink restrictions:** use a directory junction on Windows and relative symlink on Unix; if link creation fails, report the exact path without copying stale duplicates silently.
- **External skill removed/renamed:** dependency-closure validation fails before generation.
- **Package has no `src` or AGENTS:** context resolver reports the limitation and falls back to types/dist/generated facts.
- **Multiple packages claim one module:** resolver reports all candidates and requires an explicit package; it never guesses.
- **Framework versions differ:** resolver prints every relevant version and prevents mixing generated facts from one version with source from another without a warning.
- **User modified generated harness file:** ownership manifest preserves it and emits a conflict/side-by-side update rather than overwriting silently.
- **Stale `dist/agentic`:** build cleans before copy and asserts deleted paths are absent.
- **Primary live evaluator unavailable/rate-limited:** deterministic gates still run; release evidence records the external blocker rather than claiming a live pass. An unrequested secondary runner remains `null`, not failed or passed.
- **Live model produces invalid JSON:** schema validation fails the case and stores only sanitized output/error metadata.
- **Prompt injection in a PR/source guide:** content remains untrusted data; evaluator and evolve skill never execute embedded instructions.

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Rewriting generated guidance changes agent behavior broadly. | High | 193 semantic cases, mandatory safety subset, complete selected-runner release evidence, optional explicit cross-model portability evidence, draft PR, and review gate. | Model behavior remains probabilistic and secondary-runner evidence depends on optional provider access. |
| Root instructions are silently truncated by a default agent budget. | High | 12 KiB byte cap on both root sources plus representative generated initial-chain checks against 32,768 bytes (issue #4484). | Other tools may impose smaller undocumented budgets. |
| Context files still drift from framework contracts. | High | Generated facts, installed source/AGENTS escape hatch, semantic contradiction scan, release version stamps. | Hand-written conceptual guides still require maintenance. |
| Installer removes user content or breaks Windows. | High | Node path-safe implementation, ownership checks, junction tests, preserve stable flags/wrapper, generated-app tests. | Windows junction semantics vary by corporate policy. |
| Context escape hatch causes huge prompt loads. | Medium | Facts first, explicit opt-in skill, bounded module/package search, context-file budget per case. | A complex upstream bug may legitimately need wider source. |
| Shared external skills change independently. | Medium | Pin the installer CLI and collection commit, verify skill hashes/dependency closure, retain repo-local overrides, record versions in eval evidence. | Moving the pin remains an explicit maintenance task. |
| Recursive generator copy overwrites user edits. | Medium | ownership manifest + hashes; replace only unmodified owned files; no unknown-directory deletion. | First upgrade from a pre-manifest app needs conservative detection. |
| Large eval catalog becomes ceremonial. | Medium | schema, affected-tag runner, mandatory safety subset, evolve skill requires before/after execution. | Some behavioral assertions remain model-graded. |
| A generated test reaches a service bound to host loopback. | High | Complete-release preflight requires Linux/Bubblewrap before provider or writable work; Playwright gets loopback only in an unshared network namespace; macOS `sandbox-exec` is rejected for this lane. | Linux user-namespace support remains a host prerequisite. |

### Rollback

Revert the harness commits and rebuild create-app/CLI packages. No database or runtime data rollback is needed. Existing generated apps retain their emitted files until `agentic:init` is rerun; the ownership manifest allows a later fixed generator to update only harness-owned files.

## Integration and Validation Coverage

No application HTTP endpoint or customer UI is changed. Integration coverage targets both harness emission paths and the developer workflows they control.

| Path | Coverage |
|---|---|
| Fresh `create-mercato-app --agents codex`, Claude, Cursor, and multi-agent selection | One authoritative root router; correct tool files; local/external skill layout; no unresolved placeholders. |
| Fresh scaffold with `--agents none` / skipped setup | Safe fallback `AGENTS.md`; placeholder installer points to `agentic:init`; app scaffold remains valid. |
| `yarn mercato agentic:init` first run and rerun | Same emitted tree as create-app; marker/ownership idempotency; user-authored files preserved; a symlinked managed ancestor fails before any outside write. |
| `yarn install-skills --no-external` | Default local skills and correct canonical/Claude link layout without network. |
| External install with fake/recorded skills CLI | Pinned CLI invocation, repeated skill flags, 15-skill default versus opt-in automation selection, dependency closure, all-set activation/rollback including prior-ledger restoration, retry semantics, external-before-local ordering. |
| Windows simulated filesystem/command resolution | Junction/link behavior and `.cmd` spawning. |
| `yarn framework:context --module customers` | Installed core version, root/package/module AGENTS chain, `src/modules/customers`, bounded no-ignore search. |
| Missing source/duplicate module/version skew fixtures | Explicit degraded/ambiguous/skew output; no guessed edit path. |
| Deterministic harness validation | 193 schema-valid cases, existing references, no contradictory stale patterns, complete emitted module-fact coverage, context budgets, dependency closure. |
| Instruction-budget regression | Both root sources ≤12 KiB; named representative generated initial chains ≤32,768 bytes, measured as bytes. |
| Selected primary live runner | Codex or Claude read-only structured routing/decision result for all 193 cases, one fresh session per case. |
| Optional portability live runner | A different explicitly requested runner executes the exact 46-case representative read-only target; omission is recorded without blocking release. |
| Writable live runner | The selected primary runner owns disposable scaffolds and executable oracles for all 46 implementation/regression cases, with bounded controller-materialized installed-package context when declared by the case. |
| Generated test execution | Fixed-argv execution of the generated Jest units plus Linux/Bubblewrap-isolated Playwright API and browser cases in canonical module-local paths; a host-loopback listener remains unreachable. |
| Mandatory generated-code review | Post-oracle/command/test review of every writable result in a bounded source-only bundle using the pinned installed `om-code-review` skill. |
| Generated standalone install/generate/typecheck/test/build | Real npm/Verdaccio package boundary and published-path validation. |
| Semantic smoke | `/login`, one CRUD plan/flow, one UMES flow, one worker/CLI flow, and package source-context lookup. |

Targeted tests extend or replace:

- `packages/create-app/src/lib/agentic-skills-standalone-overlays.test.ts`;
- `packages/create-app/src/lib/install-skills-layout.test.ts`;
- `packages/create-app/src/setup/tools/agents-md.module-guides.test.ts`;
- `packages/create-app/src/setup/tools/shared.test.ts`;
- `packages/create-app/src/setup/wizard.test.ts`;
- `packages/create-app/src/lib/module-facts-build.test.ts`;
- create-app/CLI agentic asset parity and clean-dist tests;
- a new harness schema/router/semantic consistency suite and context resolver suite.

## Migration & Backward Compatibility

All runtime framework contract surfaces remain unchanged. The scaffold/harness surfaces are handled as follows:

1. **CLI/package scripts:** existing `install-skills` name and installer flags stay stable. New `framework:context` and `harness:validate` scripts are additive. The shell script remains a compatibility wrapper.
2. **Skill IDs:** existing standalone skill names remain routable. New skills are additive. Shared external skill names remain installed from the collection.
3. **Generated paths:** `AGENTS.md`, `.ai/agentic.config.json`, `.ai/skills`, `.ai/guides`, and `.agents/skills` retain their meaning. New `.ai/harness` files and scripts are additive.
4. **Tool layouts:** Codex/Cursor keep canonical `.agents/skills`; Claude compatibility links remain. Legacy layouts are swept only when links resolve into harness-owned targets.
5. **Module facts:** entity IDs remain colon-form; API auth continues to come from generated `apis[].metadata`; files are stamped with source package version. No frozen ID is renamed/removed.
6. **Agentic rerun:** pre-manifest apps are migrated conservatively; unknown/user files are preserved. Generated marker blocks are replaced idempotently.
7. **Published assets:** `dist/agentic` cleanup removes stale generated artifacts before package publication, with tests to prevent deleted legacy skills from reappearing.

## 📋 Phasing

### Phase 1 — Specification and gates

Define architecture, cases/schema, ownership rules, compatibility, and pre-implementation audit. Land deterministic failing tests for current contradictions and installer portability before replacing content.

### Phase 2 — Root context and local skills

Replace both root instruction sources, split local skill procedures into references, add AI/workflow/context/evolve skills, fix tool entity guards, and retain existing skill IDs.

### Phase 3 — Installer and generator

Add the Node installer, compatibility wrapper, recursive asset emission, ownership manifest, upstream snapshots, source resolver, stale-dist cleanup, and create-app/CLI parity.

### Phase 4 — Evaluation and release proof

Add all case records, deterministic/live runner, focused/generated-app/Verdaccio validation, execute the full selected-primary-runner matrix plus an optional representative secondary portability matrix, and remediate failures.

## 📋 Implementation Plan

### Phase 1: Specification and gates

1. Finalize this spec from current scaffold/package/PR evidence and run the 13-surface compatibility audit.
2. Add case/result schemas, validator registry, release matrix, and tests that fail on missing paths/owners/rule IDs, duplicate IDs, dangling relations, excessive byte/token budgets, stale route/entity/signature patterns, unsafe commands, and unresolved references.
3. Add baseline cases for all 193 tasks and mark cases 57–70 mandatory.

### Phase 2: Root context and local skills

1. Rewrite template and agentic root files to the boundary-first router contract and dynamic module markers.
2. Replace the named local skills with thin routers and focused references; add `om-create-ai-agent`, `om-build-workflow`, `om-framework-context`, and `om-evolve-harness`.
3. Rewrite tool-specific enforcement/hooks to reference the canonical root and `data/entities.ts` path without duplicating architecture prose.
4. Run router/reference/size/semantic gates and the affected use-case families.

### Phase 3: Installer and generator

1. Implement/test `install-skills.mjs`, retain the shell wrapper, update every automatic call site plus manifest/schema/package scripts, and exercise offline/external/Windows layouts.
2. Replace hard-coded create-app/CLI skill copying with the shared recursive ownership-aware emitter and placeholder handling.
3. Clean/rebuild both create-app and CLI `dist/agentic` trees, bundle version/hash-stamped upstream root/BC snapshots in both, and assert stale paths are absent.
4. Implement/test `framework-context.mjs` against installed-source, missing-source, duplicate-module, and skew fixtures.

### Phase 4: Evaluation and release proof

1. Implement deterministic, read-only Codex/Claude routing, and writable disposable-scaffold evaluation modes plus sanitized result artifacts.
2. Generate a fresh standalone app, install local/external skills, resolve upstream context, and run deterministic validation.
3. Select Codex or Claude once for the release; run all 193 primary routing cases and all 46 primary-owned writable implementation/regression target oracles, generated tests, target commands, and code reviews. Optionally request the other runner for the exact 46-case read-only portability target. Fix the smallest knowledge owner for each failure and rerun affected + mandatory cases.
4. Run create-app targeted tests, Verdaccio standalone parity where package boundaries changed, and the configured full repository gate.
5. Complete automated code review/autofix, final compliance report, PR evidence, and rollback notes.

## Final Compliance Report

| Check | Design verdict |
|---|---|
| Standalone-only placement | Implemented in create-app/CLI scaffold assets and tests; no core runtime business module or database contract changed. The root app files touched are required create-app template mirrors. |
| Tenant/security/data integrity | Implemented as universal boundaries, mandatory cases 57–70, writable oracles, and contained release execution; no runtime data access was added. |
| Canonical module mechanisms | Implemented through routed guides/skills, generated installed-module facts, and exact installed source plus nearest `AGENTS.md` resolution. |
| Backward compatibility | Implemented with stable script/skill/path contracts, additive commands/files, conservative reruns, and ownership-aware upgrades. |
| Progressive disclosure | Implemented with byte-guarded compact roots, branch-specific references, facts-first context, and measured per-case budgets. |
| External skill dependency closure | Implemented with an explicit exact pin, per-skill hashes, source/stage/install verification, ownership ledger, and no local/external duplication. |
| Cross-platform installer | Implemented with Node path handling, simulated Windows command/junction coverage, and no `jq`/POSIX dependency; the complete release gate intentionally fails closed on native macOS and Windows because only Linux/Bubblewrap provides isolated loopback. |
| Integration coverage | Implemented for fresh/skipped/rerun/install/context/eval/Verdaccio and semantic smoke paths. |
| New feature integration tests | Three generated test cases execute a focused Jest unit test, real loopback Playwright API test, and real Playwright browser test under release containment. |
| Rollback | Revert and rebuild; no data migration. |

## Changelog

- **2026-07-24** — Skeleton created under the autonomous Open Questions policy; standalone boundary, source-context, evaluation, and migration assumptions resolved from the user brief.
- **2026-07-24** — Added prior-spec/PR-history findings, the initial case catalog, thin-skill/router architecture, cross-platform installer, exact installed-source escape hatch, harness-evolution workflow, compatibility, failure scenarios, integration coverage, and phased implementation plan.
- **2026-07-24** — Added a three-axis context assembler, 12 business one-shot cases, four test authoring/execution cases, and byte-accurate issue #4484 instruction-budget regressions.
- **2026-07-24** — Added exact discovery-surface and 18-domain override catalogs plus public frontend, portal, design-system, UX, accessibility, and state-matrix coverage.
- **2026-07-24** — Source-audited those catalogs against current generators/types/docs; added vector and locale discovery, query/sync/reactive/DOM/integration mechanisms, additive AI overrides, exact registry keys, portal frozen IDs, and corrected design-system exceptions.
- **2026-07-24** — Fresh-context and pre-implementation reviews split routing evidence from writable implementation/regression oracles, pinned the external collection, defined concern-specific instruction precedence, added ownership state transitions, expanded all 14 BC assertions, and made create-app/CLI snapshot and installer call-site parity explicit.
- **2026-07-24** — Added a fail-closed writable-fixture materializer with exact case-bound markers, seed-to-write-scope validation, controller-target isolation, and executable regression seeds for the initial implementation matrix.
- **2026-07-24** — Restored standalone provider placement (local module by default, separately published dependency for explicit reuse) and scope-contract nuance for authorized tenant-wide/system jobs without weakening organization-owned data isolation.
- **2026-07-24** — Reviewer hardening made duplicate module-fact providers fail closed unless `src/modules.ts` selects one exact package; framework context now recognizes dist-only roots, compares fact package and version stamps, validates materialization path segments, and emits deterministic globally capped search artifacts with explicit status.
- **2026-07-24** — Replaced writable token scans with controller-owned AST and isolated behavior oracles, made every seeded fixture fail its precondition, added the fixed after-phase typecheck gate, and prevented writable targets from supplying executable validation code.
- **2026-07-24** — Compacted the generated enabled-module marker from per-module description/path rows to an identifier-only index with one progressive fact-sheet path rule, preserving enabled/bundled selection and fallback semantics while keeping compound routing under the initial context budget.
- **2026-07-24** — Added an independent generated-code review lane for all 31 one-shot implementation cases, binding the pinned installed `om-code-review` skill to passing target-command attestation, controller oracle evidence, and the final post-build fingerprint inside a bounded source-only bundle with sanitized strict verdict artifacts.
- **2026-07-24** — Doubled the catalog to 184 cases, grouped cases 93–184 by developer outcome, and set the writable release target to 39 cases with aligned fixture, oracle, real generated-test, mandatory review, evaluator, and release-matrix gates.
- **2026-07-24** — Strengthened the release target to 39 cases (21.2%), made generated-code review mandatory for every writable implementation/regression, and added fixed-argv execution of generated Jest, Playwright API, and Playwright browser tests under fail-closed host containment.
- **2026-07-25** — Replaced the non-waivable dual-provider release dependency with one explicit primary runner that owns all blocking live lanes, plus an optional distinct 39-case read-only portability runner recorded separately in release evidence.
- **2026-07-25** — Made the complete release gate require trusted Linux/Bubblewrap after proving macOS `sandbox-exec` shares host loopback; preflight rejects untrusted/no-op/pass-through runtimes and proves private loopback before target/provider/write activity, all build validation is network-free, and Playwright loopback stays inside an unshared namespace.
- **2026-07-27** — Hardened review portability and safety: ownership-aware staging preserves unowned skills, framework-context scans are NUL-safe and symlink-contained, writable behavior probes safely stub trusted imports, entity oracles honor explicit database-field mappings, provider quota/authentication failures abort as environment failures, and macOS/manual fixture prerequisites are documented.
- **2026-07-28** — Expanded the catalog to 187 cases and the writable/review matrix to 40; added complete-module, cache, and queue coverage; made case-schema validation executable through OMH-187; audited all 53 emitted module facts into catalog coverage; added contrastive decision vocabularies; and wired bounded controller-materialized installed-package context into declared writable cases without relaxing the dependency-tree ban.
- **2026-07-28** — Added field-tested writable OMH-188–191 and combined CRM/library OMH-192; extended the writable/review matrix to 45, added a fourth executable generated-test lane, fixed exact-string oracle execution, enforced command-local atomic/undo seams, and tightened scope, lifecycle, concurrency, CRM-link, worker-scope, and Jest review rules.
- **2026-07-29** — Re-audited Zielivia's original and generated-case findings plus #4564/#4565/#4571/#4572 against their executable owners, synchronized the remaining overview/risk counts to 192, and proved final27 deterministic 192/192; the selected live runner matrices remain the delivery gate.
- **2026-07-30** — Completed PR #4529's merge-focused remediation: final emitted controllers pass deterministic 192/192; OMH-188–192 pass focused live routing on default Codex, Claude Sonnet, and high-effort gpt-5.4-mini; repeated OMH-185 writable attempts produced actionable root-contract fixes but the final fresh attempt reached its fixed 600-second ceiling and is excluded from pass evidence. Complete 192-case primary plus 45-case writable/review release certification, with generative cases prioritized and Claude non-blocking when unavailable, continues in #4670 without weakening trace, containment, scope, or oracle contracts.
- **2026-07-31** — Added OMH-193 as the business-language parity evaluation for OMH-185, reusing its complete-module fixture and oracle while requiring the harness to infer canonical CRUD, safety, search, localization, and extension decisions without prompt-level framework prescriptions; expanded the catalog/release matrix to 193/46 without changing existing case contracts.
