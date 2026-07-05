# DS System & DS Guardian Refresh — drift fixes, new enforcement value, backend reference, structural lint

## TLDR

The design-system documentation (`.ai/ds-rules.md`, `.ai/ui-components.md`) and the `om-ds-guardian` skill have drifted from the shipped code: the Alert primitive moved to a `status`/`style`/`size` API, six undocumented token families exist in `globals.css`, the Notice/ErrorNotice deprecation finished, and the guardian still scans only `packages/core`. Meanwhile DS health data shows the fronts we are losing are no longer colors/typography (−60%/−57% since April) but empty states (15%), loading states (61%, flat), and inline SVG (regressing 24→27). This spec refreshes both assets and adds new value where it matters: broader scan scope, per-module health ranking, checks for the fronts that regress, a backend components reference, and the long-designed-but-never-implemented `eslint-plugin-open-mercato-ds`.

## Overview

Four workstreams, one branch (`feat/ds-system-guardian-refresh`), each independently reviewable:

1. **DS docs refresh** — bring `.ai/ds-rules.md`, `.ai/ui-components.md`, and the guardian's `references/token-mapping.md` in line with shipped tokens and the current Alert API.
2. **Guardian v2** — update `om-ds-guardian` SKILL.md + references + scripts: new checks, wider scan scope, per-module health report, refreshed example data, scaffold templates aligned with current patterns. Keep `.ai/skills/` and `.claude/skills/` copies byte-identical.
3. **Backend components reference** — new `.ai/ui-backend-components.md` decision-table reference for the ~150 undocumented backend component families (charts, filters, detail sections, notifications, schedule, messages, section pages, conflict/progress banners), linked from the Task Router and `packages/ui/AGENTS.md`.
4. **Structural lint** — implement `eslint-plugin-open-mercato-ds` per `docs/design-system/lint-rules.md` (6 rules, ESLint v9 flat config), wired into `yarn lint` at `warn` severity for existing code.

## Problem Statement

Evidence gathered 2026-07-05 (health check + code/docs inventory + git history since 2026-06-10):

- **Alert API drift.** `packages/ui/src/primitives/alert.tsx` exposes `status="error|warning|success|information|feature"` + `style="filled|light|lighter|stroke"` + `size="xs|sm|default"` + `showIcon`/`icon`/`dismissible`/`action`; the legacy `variant` prop is `@deprecated` BC mapping. All three docs and the guardian scaffold/review flows still teach `variant="destructive"`, so every new page and every guardian suggestion is born deprecated.
- **Undocumented tokens.** `--status-pink-*` (full 4-role family), 10 named `--chart-*` colors, `z-modal-elevated` (55), `--shadow-focus` / `--shadow-switch-thumb`, `--focus-ring-inner/outer`, font stacks — all shipped in `globals.css` (app and create-app template, byte-identical), none documented.
- **Finished migrations documented as pending.** Notice imports 21→1, ErrorNotice 8→2 (BC allowlist only); guardian commentary still says "Notice deprecation not started".
- **Blind spots.** Guardian ANALYZE/MIGRATE target `packages/core/src/modules/` only; `packages/enterprise`, `packages/ui/src/backend`, and other workspaces are unscanned.
- **Losing fronts unaddressed.** Empty states 25/163 (15%), loading states flat at 61%, inline SVG regressing (+3), raw fetch regressing (+1). The guardian reports these globally but cannot say which module to fix nor prevent new violations.
- **Backend component discovery gap.** ~20% of `packages/ui/src/backend` components are documented; contributors and agents re-implement existing charts/filters/sections, creating tomorrow's drift.
- **Designed-but-unshipped enforcement.** `docs/design-system/lint-rules.md` fully specifies 6 ESLint rules; none exist in the repo.

## Proposed Solution

### Workstream 1 — DS docs refresh

`.ai/ds-rules.md`:
- Status token section: add `pink` to the status enum with usage guidance (stage/category accents — e.g. pipeline stage badges — NOT a semantic error/success signal; do not map entity state to pink).
- New "Chart Colors" subsection: the 10 named `--chart-*` tokens with the rule "charts use `chart-*`, never status tokens; status tokens never appear in charts".
- Z-index table: add `z-modal-elevated` (55) between `z-toast` and `z-popover` rows with its use case (modal stacked above another modal, e.g. confirm-on-drawer).
- Shadows: document `shadow-focus` (the only sanctioned focus halo) and `--shadow-switch-thumb` (component-internal, do not reuse).
- Typography: document font stacks (`--font-geist-sans/mono`) and `text-overline` line-height.
- Feedback section + component quick reference: rewrite Alert row to the `status`/`style`/`size` API; mark `variant` as deprecated BC; state Notice/ErrorNotice migration as complete (guard test enforces the allowlist).
- New "Recent Patterns" additions where they belong: Tabs `count` badge (filter tabs with unread counts), Calendar month/year grid (single-month pickers).

`.ai/ui-components.md`: update the Alert section to the new API (props table, all four styles × five statuses, sizes, dismiss/action slots, BC note for `variant`, when-to-use-which-style guidance mirroring the Figma contract).

Guardian `references/token-mapping.md`: add pink/do-not-migrate guidance, `z-[55]`→`z-modal-elevated` mapping, legacy Alert `variant`→`status` mapping table (this becomes a MIGRATE target), and mark the Notice/ErrorNotice component-mapping section as historical.

### Workstream 2 — Guardian v2

`SKILL.md` changes:
- **Scan scope**: all ANALYZE/MIGRATE/verify greps parameterized over `packages/core/src/modules/ packages/enterprise/src/modules/ packages/ui/src/backend/` (and accept an explicit path argument).
- **New ANALYZE checks** (with severities): legacy `<Alert variant=` usage (WARNING), `<Notice`/`ErrorNotice` outside BC allowlist (CRITICAL), inline `<svg>` count with trend vs last report (WARNING), DataTable page without `EmptyState`/`emptyState` prop (CRITICAL — this is the biggest coverage gap), raw `fetch(` in backend/frontend module code (CRITICAL), `status-pink` used for error/success semantics (WARNING), `z-[N]` arbitrary z-index (WARNING).
- **REPORT v2**: per-module breakdown table (violations by category per module) + "top offenders" ranking + coverage percentages per module, so "suggested next module" is computed, not guessed.
- **Fresh reality**: replace stale example numbers/commentary with the 2026-07-05 data; note colors/typography are in maintenance mode and states/SVG are the active fronts.
- **SCAFFOLD**: templates updated to new Alert API, `EmptyState` mandatory in list template, Drawer anatomy (Title 18px + Description muted, equal footer), Tabs+count for filter tabs.
- Cross-reference the new backend components reference and the ESLint plugin ("prefer wiring the rule to chasing the grep").

`scripts/ds-health-check.sh`: add per-module loop producing a ranked table (module, hardcoded colors, arbitrary text, missing empty state, inline SVG); keep global totals and delta logic; extend scanned roots as above.

Copy sync: `.claude/skills/om-ds-guardian/**` updated to stay byte-identical with `.ai/skills/om-ds-guardian/**` (verified with `diff -rq` in validation).

### Workstream 3 — Backend components reference

New `.ai/ui-backend-components.md` — decision-table-first (mirroring `.ai/ui-components.md` style):
- "I need to…" master table across families: charts (`BarChart`, `LineChart`, `PieChart`, `Sparkline`, `KpiCard`, `TopNTable`), filters (`FilterBar`, `AdvancedFilterBuilder`, `ActiveFilterChips`, `QuickFilters`, `FilteredEmptyResults`), detail sections (`SectionHeader`, `NotesSection`, `AttachmentsSection`, `AddressesSection`, `ActivitiesSection`, `TagsSection`, `InlineEditors`, `TabEmptyState`), page scaffolding (`Page`, `SectionPage`, `SectionNav`, `SettingsPageWrapper`, `DashboardScreen`), feedback/system (`RecordConflictBanner`, `LastOperationBanner`, `ProgressTopBar`, `NotificationBell`/`NotificationPanel`), schedule (`ScheduleView` family), messages (`MessageComposer`, `EmailThreadsPanel`, `SendObjectMessageDialog`), forms chrome (`FormHeader`, `FormFooter`, `FormActionButtons`, `ActionsDropdown`), misc (`RowActions`, `TruncatedCell`, `ContextHelp`, `NextStepCallout`).
- Per family: one-paragraph purpose, import path, minimal example, MUST/NEVER rules, reference call site in core modules.
- Explicit "internal — do not consume" list for shell/infrastructure components (`AppShell`, `BackendChromeProvider`, `AuthSessionGuard`, `OrganizationScopeBoundary`, …).
- Links: root `AGENTS.md` Task Router row, `packages/ui/AGENTS.md` pointer, guardian SKILL.md reference.

### Workstream 4 — `eslint-plugin-open-mercato-ds`

- Location: `packages/eslint-plugin-ds/` npm workspace (`@open-mercato/eslint-plugin-ds`), plain JS or TS matching repo lint tooling; exports `rules` + `configs.recommended` for flat config.
- Rules per `docs/design-system/lint-rules.md`: `require-empty-state`, `require-page-wrapper`, `no-raw-table`, `require-loading-state`, `require-status-badge`, `no-hardcoded-status-colors` (the last with replacement suggestions from the token-mapping table).
- Additions beyond the doc (cheap, aligned with guardian v2): extend `no-hardcoded-status-colors` mapping to the full token-mapping table; file-scope config matches guardian scan scope (`packages/{core,enterprise}/src/modules/**/backend/**`, `packages/ui/src/backend/**`).
- Wiring: dedicated `eslint.ds.config.mjs` + root script `yarn lint:ds` with ALL rules at `warn` (rollout plan from lint-rules.md L.0; flipping to `error` is a follow-up once counts allow). Rationale for the separate config discovered during implementation: `yarn lint` (`turbo run lint`) only lints `apps/mercato`, and running the full Next.js ruleset over `packages/**` would drown the DS signal in unrelated pre-existing findings. The config sets `noInlineConfig` because app code carries disable directives for rules (react-hooks/*) that are not loaded in this ruleset.
- Tests: `RuleTester` cases per rule (valid/invalid) run by the workspace test command.
- `docs/design-system/lint-rules.md` updated to point at the real implementation.

## Architecture

No runtime architecture changes. All changes are documentation, agent-skill assets, shell scripts, and a dev-only lint workspace. The ESLint plugin is a devDependency-level workspace; it does not enter any build artifact or app bundle.

## Data Models

None. No entities, migrations, or API changes.

## API Contracts

None. Contract surfaces per `BACKWARD_COMPATIBILITY.md` are untouched: no types, signatures, import paths, event IDs, spot IDs, routes, DB schema, DI keys, ACL features, or generated files change. The Alert `variant` prop stays in place (already `@deprecated` with BC mapping) — docs change, code does not.

## Migration & Backward Compatibility

- Docs-only workstreams (1–3) have no BC surface.
- The ESLint plugin lands at `warn` severity for all rules, so `yarn lint` exit codes do not change for existing code; no CI breakage. Escalation to `error` is explicitly out of scope for this spec.
- Guardian scripts keep their CLI shape (`bash .ai/scripts/ds-health-check.sh`); new per-module output is additive. Existing saved reports in `.ai/reports/` remain comparable — the delta section keys off the global metric lines, which are preserved verbatim.

## Risks & Impact Review

| Risk | Scenario | Severity | Mitigation | Residual |
|---|---|---|---|---|
| Lint noise | 6 new rules produce thousands of warnings, devs tune them out | Medium | `warn` only; scope limited to backend page globs; counts reported in PR description | Low — warnings are informational until a later spec flips severity |
| False positives in heuristic rules | `require-status-badge`/`require-loading-state` flag legitimate code | Medium | Heuristics kept conservative (import-presence checks); rules documented with disable guidance (`eslint-disable-next-line` + reason) | Low |
| Skill copy drift | `.ai/skills` and `.claude/skills` diverge after this change | Low | `diff -rq` check added to guardian validation section; both updated in same commit | Low |
| Doc/reality drift recurring | This refresh goes stale like the last one | Medium | Guardian REPORT v2 includes a "docs freshness" line comparing Alert API + token list against docs; backend reference includes generation notes | Medium — process, not tooling, ultimately owns this |
| Health-report delta break | Reformatted report breaks delta comparison with old reports | Low | Global metric lines preserved byte-compatible; per-module table appended after END marker | Low |

## Validation Plan

```bash
yarn lint                      # includes new plugin at warn; must exit 0
yarn workspace @open-mercato/eslint-plugin-ds test
bash .ai/scripts/ds-health-check.sh   # runs, saves report, prints per-module table
diff -rq .ai/skills/om-ds-guardian .claude/skills/om-ds-guardian   # empty
```

Integration coverage: not applicable — no API or UI runtime paths change. The ESLint rule tests (RuleTester) are the executable coverage for the only code added.

## Final Compliance Report

- No cross-tenant/data-security surface touched.
- No hardcoded user-facing strings introduced (docs and lint messages are developer-facing).
- No contract surface modified; deprecation protocol not triggered.
- Generated files untouched; no `yarn generate` needed (new workspace has no module auto-discovery files).

### Workstream 5 — Tabs migration (added during implementation)

Migrate the worst hand-rolled tab strips to the `Tabs` primitive (`variant="underline"`), per the new page-templates pattern:

- `TabsList` gains an additive `aria-label` prop (primitive change, approved in-review) so bare section switchers stay accessible.
- Migrated: `customers/DetailTabsLayout`, `integrations/[id]` page (pill→underline + `leading` icons, drops ~7 copies of a reset-override className), `planner/availability-rulesets/[id]` page, `ui/backend/detail/AttachmentMetadataDialog`.
- `customers/deals/pipeline/ViewTabsRow` intentionally stays link-based (`<Link>` navigation between two routes — the state-driven primitive does not fit); aligned its tokens instead (`shadow-focus`, `border-accent-indigo`).
- Second wave (same PR): migrated customers `PersonDetailTabs`/`CompanyDetailTabs`/`DealDetailTabs`/`MobilePersonDetail` (counts → `count` prop incl. `999+` cap and `NEW`, icons → `leading`, arrow-key nav preserved), planner `AvailabilityRulesEditor`, `resources/[id]` (both strips), `audit_logs` page, staff `team-members/[id]`/`teams/[id]/edit`/`SavedViewTabs`, attachments `AttachmentContentPreview`.
- Intentionally NOT migrated (token-aligned only — `shadow-focus` + `border-accent-indigo`): `ui/backend/AppShell` (mobile drawer switcher with `aria-controls` wiring to an external panel that `TabsTrigger` cannot express), `ui/ai/ChatPaneTabs` (composite browser-style session tabs with nested rename/close controls — invalid HTML inside a single-button trigger), customers `ViewTabsRow` (link-based route navigation). These three are the complete remaining `role="tab"` surface outside the primitive.

## Changelog

- 2026-07-05 — Spec created; scope agreed (full variant: drift refresh + guardian v2 + backend reference + structural lint).
- 2026-07-05 — Workstream 5 added on review: in-PR migration of the four worst tab strips to `Tabs variant="underline"` + additive `aria-label` on `TabsList`; remaining call sites listed as follow-up.
- 2026-07-05 — Workstream 5 completed in full: second wave migrated the remaining 11 state-driven tab strips; `AppShell`, `ChatPaneTabs` and `ViewTabsRow` documented as intentional non-migrations (token alignment only). Raw `role="tab"` outside the primitive is now limited to those three.
