# CLI `module search` and `module info` (Open Mercato Modules catalog)

## TLDR

Two read-only subcommands, `yarn mercato module search <query>` and `yarn mercato module info <ref>`, answer "does a
module for this already exist?" from the [Open Mercato Modules](https://modules.openmercato.com) catalog before a
developer or a coding agent builds one. Built-in core modules come first, then catalog modules verified on the app's
Open Mercato line, each with the exact install command. `--json` prints the catalog's `tools@1` cards, a stable
contract for agents. Nothing is installed or changed.

## Overview

- Package: `@open-mercato/cli` (`packages/cli/src/mercato.ts`, `packages/cli/src/lib/module-search*.ts`).
- Data: the catalog's published files `/modules.json` (`ModulesIndex`, schema version 1) and `/built-in.json`.
- Ranking and card shape: the catalog's own (`lib/core/search.ts`, `lib/core/refs.ts` and the `search_modules` /
  `get_module` tools of its MCP server, contract `tools@1`), mirrored and pinned by a parity test.
- Related: `.ai/specs/2026-06-09-create-app-module-picker.md` (the same catalog, `picker.json`, at scaffold time).

## Problem Statement

`yarn mercato module add` installs a package once you know its name. Nothing in the CLI tells you whether a module
already exists, whether it is built into core (and only needs `module enable`), or whether a community package was
verified on your Open Mercato version. Agents working in an app build features from scratch that already exist as
modules.

## Proposed Solution

```bash
yarn mercato module search <query> [--category <id>] [--kind <kind>] [--all-lines] [--limit <n>] [--json]
yarn mercato module info <package-or-module-id> [--json]
```

- Line of the app: `node_modules/@open-mercato/core/package.json`, else the `@open-mercato/core` range in
  `package.json`; mapped to a catalog line (`0.9`, `next` for develop builds). A version the catalog does not test
  shows every line with a note.
- Default filter: catalog entries verified on that line (`version.recommended[line]`, so a new release in the Yarn
  age gate does not hide a module) plus built-in modules; the rest is counted in `hidden` and named in one closing
  line (`N more modules are listed but not verified on 0.9. Use --all-lines.`). When every match is hidden the
  first line says `No modules verified on <line> matched "<query>".`
- `installable from: <date>` is printed only while that date is ahead and the install version is not verified.
- No telemetry; the only requests are the two downloads.

## Architecture

```
mercato.ts module search|info (no bootstrap, no DB, no generators)
  -> module-search-args.ts   flag parser (module-install-args.ts style)
  -> module-search.ts        loadIndex (fetch, cache, ETag, stale copy), detectAppContext, views, renderers
  -> module-search-index.ts  catalog parity layer: MiniSearch 7.2.0 index, searchModules, resolveLine, resolveRef
```

Network: `OM_MODULES_INDEX_URL` or `https://modules.openmercato.com/modules.json`, `built-in.json` next to it
(`OM_MODULES_BUILTIN_URL` to override); 4 s timeout, one retry after a network error or a 5xx.

## Data Models

No database entities. One cache file in the app, `.mercato/cache/modules-index.json` (already gitignored):

```ts
type ModuleIndexCache = {
  cacheVersion: 1
  url: string
  builtInUrl: string
  fetchedAt: string            // ISO time
  etag: string | null
  builtInEtag: string | null
  index: ModulesIndex          // catalog modules.json, validated at runtime
  builtIn: BuiltInIndex | null
}
```

Fresh for 10 minutes (used without a request and without a message); afterwards revalidated with `If-None-Match`.
When revalidation fails the older copy is used with `Using cached module index from <date>.` on stderr.
A downloaded index is checked down to every nested field search and `module info` read, and the searcher is built
from it, before it replaces the cached copy; one that fails either counts as a failed revalidation. A cached copy
that fails the same check is ignored and downloaded again.
A copy without the built-in list (`builtIn: null`) is never fresh: the next run asks for `built-in.json` again. When
that list is missing, both commands print `Built-in module list unavailable; results may miss modules already in Open
Mercato core.` and `Reason: <detail>` on stderr, and `module search --json` adds `builtInUnavailable: true`.

## API Contracts

CLI commands are a contract surface (BACKWARD_COMPATIBILITY.md section 13): both commands and all flags are new and
additive.

`module search --json` (stable, `schemaVersion: 1`, fields only added):

| Field | Type |
| --- | --- |
| `schemaVersion` | `1` |
| `query` | `string` |
| `line` | `string \| null` |
| `omVersion` | `string \| null` |
| `builtIn` | `BuiltInCard[]` (`tools@1`, plus `enabled: boolean \| null` from `src/modules.ts`) |
| `builtInUnavailable` | `true`, only when the built-in list could not be loaded (`builtIn` may then miss core modules) |
| `results` | `ModuleCard[]` (`tools@1`) |
| `total` | `number`, matches on any line |
| `hidden` | `number`, matches not verified on `line` (`0` with `--all-lines`) |
| `dataVersion`, `generatedAt` | `string`, version and time of the catalog data |

`module info --json`: `{ schemaVersion, line, entry, candidates, anatomy: null, warnings, untrusted: null, card }`,
or `{ schemaVersion: 1, error, candidates }` with exit code 1 for an unknown module.

Exit codes: `0` success (also when nothing matched), `1` usage or unknown module, `2` index unavailable without a
cached copy. Exit 2 prints `Module index unavailable. Check your connection or set OM_MODULES_INDEX_URL.` and a
second line `Reason: <detail>` (for example `Reason: https://mirror.example.com/nope.json answered 404`).

## Integration Coverage

No API route and no UI path is added, so there is no `.ai/qa/tests/` scenario. Coverage is in unit tests
(`packages/cli/src/lib/__tests__/module-search.test.ts`, `packages/cli/src/__tests__/mercato.test.ts`) with the
catalog's fixture through an injected `fetch`: parity with `search_modules` and `get_module`, golden queries,
`--json` keys, line filter and `--all-lines`, line detection, download, TTL cache, ETag 304, retry, stale copy,
a malformed or unsearchable download that keeps the cached copy, a cached copy the CLI cannot read,
exit code 2 with its reason, `OM_MODULES_INDEX_URL`, `module info` text and JSON.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
| --- | --- | --- | --- | --- |
| Catalog domain down or not yet serving | Medium | Both commands | 4 s timeout, one retry, stale copy, exit code 2 with the reason; nothing else in the CLI depends on it | No answer without a copy |
| Ranking drifts from the catalog site and MCP | Medium | Agents get different answers per channel | Same MiniSearch version and options; parity test against the catalog's own tool output | Catalog changes need a CLI release to follow |
| Catalog changes `modules.json` | Medium | Parsing | Runtime validation; an unknown `schemaVersion` makes the index unavailable instead of crashing | Additive catalog fields are ignored until read |
| Module text is author-supplied | Low | Agents reading output | The CLI only prints; installing stays a separate `module add` the user runs, with `--allow-third-party` outside `@open-mercato/*` | An agent may still quote the text as advice |

## Final Compliance Report

- Additive CLI surface only; `module add | enable | eject` unchanged.
- New dependency `minisearch@7.2.0` (no transitive dependencies), loaded only by these commands.
- Docs: `apps/docs/docs/cli/module-search.mdx`.
- Catalog side: spec of the Open Mercato Modules catalog, section 9.1, and its `tools@1` contract.

## Changelog

- 2026-10-23: Initial spec, implemented in the same change.
- 2026-10-25: A malformed index (an entry with `providers: [null]`) can no longer replace a working cached copy:
  nested fields are validated and the searcher is built before the copy is saved.
