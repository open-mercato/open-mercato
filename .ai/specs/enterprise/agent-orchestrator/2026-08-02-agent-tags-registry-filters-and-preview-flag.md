# Agent Tags, Registry Filters and the Preview-UI Flag

**Date:** 2026-08-02
**Module:** `agent_orchestrator` (enterprise)
**Status:** Implemented

## Goal

Three related fixes to the agents cockpit:

1. The **Filters** button on the agents registry did nothing. Make filtering real.
2. Operators cannot organize their fleet. Give them **tags** that work for file
   agents too, and let them filter and search by tag.
3. Several cockpit controls were built ahead of their backend and either do
   nothing, only raise a toast, or render invented figures. Put every one of them
   behind a **default-off env flag** so a normal deployment never shows a control
   that cannot do what it promises.

## 1. Tags

### Where they live

Agent definitions are code/file-authored and global, so there is no per-agent
row to hang a tenant's taxonomy on except `agent_settings`, which already carries
the per-(tenant, organization) presentation icon. Tags become a second column on
that table:

```
agent_settings.tags  jsonb null   -- normalized string[]
```

Keyed by agent DEFINITION id (`deals.health_check`), not an FK. That is what
makes the row survive an agent that is not in the live registry (module
uninstalled, agent renamed, agent turned off): the tags come back with it, and
nothing has to cascade when the registry changes.

Migration: `Migration20260802090000_agent_orchestrator` + snapshot.

### Normalization

`data/agentTags.ts` (server-safe, no ORM imports, like `data/agentIcons.ts`) is
the single normalizer used by the validator, both API routes, the tag editor and
the registry filter:

- trim, collapse inner whitespace, lowercase
- cap each tag at `AGENT_TAG_MAX_LENGTH` (32) and the list at
  `AGENT_TAGS_MAX_COUNT` (20)
- drop blanks/non-strings, dedupe keeping first occurrence

Both sides MUST normalize identically. If the editor stores `Sales Ops` and the
filter compares `sales ops`, the filter silently returns nothing, which is the
exact failure mode this file exists to prevent.

### API

| Route | Change |
|-------|--------|
| `GET /agents` | adds `tags: string[]` per item, from `getAgentPresentationMaps` (one query for icons + tags instead of two scans of the same rows) |
| `GET /agents/:id` | adds `tags: string[]`; `iconUpdatedAt` is now the shared settings-row lock version for both icon and tags |
| `PUT /agents/:id/settings` | `icon` and `tags` are both **optional**; an omitted field is left unchanged, so a tags-only write works and the pre-existing icon-only body from older clients keeps working. Response adds `tags`. |

Still gated by `agent_orchestrator.agents.manage`, still optimistic-locked on the
settings row's `updated_at`.

### UI

- **Agent detail** header card: a `TagsInput` with suggestions drawn from every
  tag already in use across the registry (`useAgentTagSuggestions`), so operators
  reuse `billing` instead of inventing `billings`. Custom values stay allowed.
  Saves on change through the same guarded-mutation + optimistic-lock path as the
  icon picker, and refreshes the lock version from the response.
- **Agents registry**: a `Tags` column, a `tags` filter, and tags folded into the
  free-text search.

## 2. Registry filters

`GET /agents` returns the entire registry in one unpaged response (it is a code
list, not a table), and the page already slices it for pagination, so matching is
in-memory in `backend/agents/agentListFilters.ts` rather than query params the
endpoint does not have.

Facets: type (`resultKind`), runtime, autonomy, status, tags. Search covers id,
label, description and tags.

Semantics: **values OR inside one facet, facets AND together.** Tags follow the
same rule, so picking a second tag widens the set exactly like picking a second
runtime does; a single rule is easier to predict than a per-facet exception.

The page's own dead `Filters` button is gone: filtering rides `DataTable`'s
`FilterBar`, which owns the trigger, the active-count badge and the apply/clear
flow, plus `filterAwareEmptyState` for the empty-after-filtering case.

## 3. Preview-UI flag

`lib/featureFlags.ts` → `isAgentPreviewUiEnabled()`, reading
`NEXT_PUBLIC_OM_AGENT_ORCHESTRATOR_PREVIEW_UI` (with the non-public
`OM_AGENT_ORCHESTRATOR_PREVIEW_UI` as the server-side twin), parsed with
`parseBooleanWithDefault(raw, false)`. It MUST stay a bare `process.env.<NAME>`
member expression: Next.js inlines `NEXT_PUBLIC_*` only for that exact form.

Hidden when off:

| Surface | What it was |
|---------|-------------|
| Agents registry: `Export` | button with no handler |
| Agents registry: `New agent` | toast-only ("defined in code for now") |
| Agents registry row actions: `Duplicate`, `Disable` | toast-only |
| Agent detail: `Pause` | toast-only |
| Agent detail: `Configure` + `AgentConfigDrawer` | every field disabled, Save disabled |
| Process detail: `Pause` / `Reassign` / `Take over` + the "coming soon" note | permanently disabled buttons |
| Overview: "Where humans stepped in" | hardcoded demo counts (412/188/96/61/53) |
| Overview: `Operator ratio`, `SLA breaches` tiles | value is a "Needs backend" chip |
| Caseload: `Closed today` tile | value is a "Needs backend" chip |
| Trace detail: model comparison card | hardcoded confidence/cost figures |

Two grids adapt their column count so the remaining tiles do not stretch (agents
overview KPIs 4→2, caseload lifecycle 4→3).

Nothing was deleted: turning the flag on restores every surface exactly, which
keeps the target UX available for design review without shipping it as if it
worked.

## Testing

`__tests__/agent-tags-and-filters.test.ts` — normalization (casing, whitespace,
length/count caps, non-array input), the write schema's tags-only and
icon-only bodies, the filter predicate (OR-in-facet / AND-across-facets, tag
matching including a differently-cased pick, search over id/label/description/
tags), and translation coverage for all four locales.

`__tests__/preview-ui-flag.test.ts` — the flag defaults off, accepts truthy
tokens, honours the server-side twin, stays off for an unparseable value; plus a
source assertion that every gated file still reads the flag, so a later edit
cannot quietly reintroduce an ungated dead control.

## Migration & Backward Compatibility

Additive only.

- `agent_settings.tags` is nullable with no default; existing rows read as no
  tags.
- `agentIconWriteSchema.icon` went from required to optional. Every existing
  caller sends it, and an omitted field now means "leave unchanged", so no
  request that used to succeed changes behaviour.
- `GET /agents` and `GET /agents/:id` gain a field; no field changed shape.
- `getAgentIconMap` keeps its signature (it now delegates to
  `getAgentPresentationMaps`).
- The preview flag defaults OFF, so the visible cockpit loses the listed dead
  controls on upgrade. That is the intent; a deployment that wants them back sets
  the env var.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|------|----------|------------|----------|
| Editor and filter normalize differently, so a tag filter silently returns nothing | High (silent wrong result) | One `normalizeAgentTags` used by validator, both routes, editor and filter; covered by a differently-cased filter test | Low |
| Two quick tag edits race on the shared settings row and 409 | Medium | The input is disabled while saving and the lock version is refreshed from each response; a real conflict surfaces through `surfaceRecordConflict` and reloads | Low |
| In-memory filtering degrades if the registry grows large | Low | The list endpoint is already unpaged and fully client-rendered, so filtering adds no new ceiling; moving to server-side filters is a contained follow-up | Accepted |
| Operators lose controls they were used to seeing | Low | Nothing is deleted; the env flag restores every surface, and the removals are listed in `.env.example` | Accepted |
| `NEXT_PUBLIC_*` is refactored into a dynamic lookup and silently reads undefined in the browser | Medium | Documented on the helper and enforced by keeping the bare member expression | Low |

## Changelog

- **2026-08-02** — Implemented: `agent_settings.tags` + migration, tags on the
  agents list/detail APIs and the settings write, tag editor on the agent detail
  header, working registry search + facet/tag filters, and
  `NEXT_PUBLIC_OM_AGENT_ORCHESTRATOR_PREVIEW_UI` gating every unimplemented
  cockpit control. Tests: `__tests__/agent-tags-and-filters.test.ts`,
  `__tests__/preview-ui-flag.test.ts`.
