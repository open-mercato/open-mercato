# Catalog links point at www.openmercato.com/run

## Goal

Links and printed strings that people read point at the module catalog's final address under the main site (`https://www.openmercato.com/run/...`) instead of `https://modules.openmercato.com/...`.

## Scope

The catalog (open-mercato/modules) moves under the main site as its "Run" section. Address mapping for pages:

| Today | After the switch |
|---|---|
| `https://modules.openmercato.com` and `https://modules.openmercato.com/` | `https://www.openmercato.com/run/modules` |
| `https://modules.openmercato.com/<path>` (`templates`, `compat`, `radar`, `quality`, `for-agents`, `built-in`, `submit`, `submit?npm=...`, `about`, `c/<category>`, `m/<package>`, `t/<template>`) | `https://www.openmercato.com/run/<path>` |

Affected areas:

- `apps/docs/docs/**`, `README.md`, `packages/create-app/README.md` — links and visible link text.
- `packages/cli/src/lib/module-search.ts` — `MODULES_SITE_URL` ("Browse the catalog: ...").
- `packages/create-app/src/lib/ready-apps.ts` (ready-apps hint), `packages/create-app/src/index.ts` (help text), `packages/create-app/src/lib/catalog/catalog-step.ts` (`MODULES_SITE_URL`, printed in catalog warnings).
- `packages/create-app/agentic/shared/ai/skills/om-find-module/SKILL.md` — `curl -s` becomes `curl -sL`, the module card becomes a `curl -sL` call; URLs stay on `modules.openmercato.com`.
- Unit tests that assert these strings.

## Non-goals

- No behaviour change, no new options, no refactor.
- Machine endpoints stay on `https://modules.openmercato.com`: `modules.json` (`DEFAULT_MODULES_INDEX_URL`), `built-in.json`, `picker.json` (`DEFAULT_PICKER_URL`), `templates.json` (`DEFAULT_TEMPLATES_URL`), `/schema/*.json`, `llms.txt`, `/raw/*`, `/m/<package>.md`, badge images, the MCP server address.
- Test fixtures that mirror catalog data (`packages/cli/src/lib/__fixtures__/module-search/**`, and assertions on values derived from fixture data such as `index.site`, `card`, `install plan`) stay.
- `Template page: ...` and `No template with slug "...". See <site>/templates ...` in `create-mercato-app` are derived at runtime from the template index URL (`new URL('/t/...', indexUrl)`, `new URL('/templates', indexUrl)`), so they follow whatever index the user reads; changing them would change behaviour. They stay, and the old host redirects them.
- `.ai/specs/**` is history and is not touched.
- No `CHANGELOG.md` entry: release notes are generated from the PR's category label (`.ai/docs/pr-workflow.md` § Release-note labels).

## Implementation Plan

### Phase 1: Documentation links

- 1.1 Update catalog links and link text in `apps/docs/docs/**`.
- 1.2 Update catalog links in `README.md` and `packages/create-app/README.md`.

### Phase 2: Strings the tools print

- 2.1 `packages/cli`: `MODULES_SITE_URL` and the test asserting "Browse the catalog: ...".
- 2.2 `packages/create-app`: ready-apps hint, `--template` help text, `MODULES_SITE_URL` in `catalog-step.ts`, and the tests asserting the catalog warnings.

### Phase 3: om-find-module skill

- 3.1 `curl -sL` on every fetch and for the module card; pin it in the overlay test.

## Risks

- The new addresses answer 404 until the catalog is switched. The PR must not merge before that; it stays a draft with `do-not-merge`.
- The sample output in `apps/docs/docs/cli/module-search.mdx` (`more: .../m/<package>`) shows a URL the CLI builds from the index's `site` field. The docs are updated to the final page address on the assumption (inference from the catalog branch's base-path configuration, not verified end to end) that the switched catalog publishes `site` under `www.openmercato.com/run`.
- A machine endpoint changed by mistake would make a tool depend on a redirect it does not need. Mitigation: after the edits, every remaining and every changed occurrence is listed and checked against the Non-goals.

## Progress

PR: #9557

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Documentation links

- [x] 1.1 Update catalog links and link text in apps/docs/docs — e9ba7d7a6
- [x] 1.2 Update catalog links in README.md and packages/create-app/README.md — 68ba81d4c

### Phase 2: Strings the tools print

- [x] 2.1 packages/cli MODULES_SITE_URL and its test — d51fa1d99
- [x] 2.2 packages/create-app ready-apps hint, help text, catalog-step MODULES_SITE_URL and tests — 28c3ab5d8
- [x] Post-review fix: update the two regex assertions for the templates address (ready-apps.test.ts, templates.test.ts) — fb9fff8ef

### Phase 3: om-find-module skill

- [x] 3.1 curl -sL on every fetch and the module card, pinned in the overlay test — 381e89d3c
