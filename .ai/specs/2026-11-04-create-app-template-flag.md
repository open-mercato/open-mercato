# create-mercato-app --template: create an app from an app template

- **Status:** Implemented on `feat/create-app-template` (steps 2 to 6), not merged or released. Phase 4 of the
  Templates umbrella spec. The integration case was written but not run locally (it needs Verdaccio and ports).
- **Date:** 2026-11-04
- **Scope:** OSS
- **Owner:** Platform / DX (proposed by Wojtek Szyjka; core team review)
- **Affected package:** `packages/create-app` (`create-mercato-app`)
- **Related:**
  - Umbrella spec: [Templates](https://github.com/open-mercato/modules/blob/main/docs/specs/2026-10-29-templates.md)
    in `open-mercato/modules` (decisions D3, D5, D8, A5, A6, A8; sections "create-mercato-app --template
    (Phase 4)", "Hold policy", "Untrusted archives", "Provenance in created apps", "In-repo manifest")
  - `.ai/specs/implemented/2026-03-02-ready-apps-framework.md` (amended here, see "Amendments")
  - `packages/create-app/AGENTS.md` (amended here, see "Amendments")
  - `.ai/specs/2026-06-09-create-app-module-picker.md` (#8118 merged 2026-10-30; the picker offered by default
    in #8718, open)

---

## TLDR

`create-mercato-app` gets one new source flag:

```
npx create-mercato-app my-app --template <slug | owner/repo>[#ref] [--keep-name]
```

- The CLI reads the catalog index `https://modules.openmercato.com/templates.json` (override `OM_TEMPLATES_URL`,
  `https://` or loopback only), selects **one commit sha**, prints `owner/repo@sha` and whether that sha is
  verified, and only then downloads it through the existing `--app-url` GitHub tarball fetch (`GITHUB_TOKEN`,
  API base override, private repos).
- A curator slug (`--template crm`) needs the index. `owner/repo` works without it and for unlisted or private
  repos ("not listed, not verified").
- Entries the index lists as `hold` are refused with their reason. `unmaintained` entries work and print it.
- New behavior for `--template` only: a compatibility warning against the latest stable Open Mercato line, an
  Enterprise license notice, the `name` rewrite (opt out with `--keep-name`), provenance in `package.json`,
  removal of `mercato-template.json`, removal of the target directory when the import fails, and next steps with
  `cp .env.example .env` and the declared env keys.
- The shared archive fetch gets limits for every import, so `--app` and `--app-url` get them too: a streamed
  download cap, entry and extracted-size caps, regular files and directories only, `lstat` validation.
- This spec explicitly amends three rules of the Ready Apps spec and two rules of `packages/create-app/AGENTS.md`,
  for `--template` only (umbrella decision D3).

---

## Overview

The Templates umbrella spec (decided 2026-10-29) adds app templates to the Open Mercato Modules catalog: a template
is a GitHub repo with a complete standalone app at its root, saved with `create-mercato-template` (Phase 2) and
listed in the catalog with curated metadata and per-commit facts (Phase 1a). Phase 4 is the create side in this
repository: `create-mercato-app --template`.

The flag is a thin layer over the ready-app import that already exists (`--app-url`, since 0.5.0): it adds an index
lookup in front of the fetch, safety limits inside the fetch, and a short post-processing step after it. The bare
scaffold, the presets, the module picker and the agentic wizard are not touched.

`templates.json` is not live yet; another branch of `open-mercato/modules` builds it (Phase 1a). This spec codes
against the umbrella contract, and the tests use a mocked index in that shape.

---

## Problem Statement

Evidence from this repository (`main` at 66f0e39db plus #8718, 2026-11-04) and GitHub:

| Fact | Effect |
|---|---|
| `--app <name>` resolves `open-mercato/ready-app-<name>` at tag `v<cli version>` (`ready-apps.ts:117-133`). No such repo with such a tag exists; the only org repo is `ready-app-oss-prm`, with no tags and no license. | Every `--app` call fails, including the `--app prm` example in `--help` (`index.ts:96`) and the README. |
| Discovery was the `open-mercato/ready-apps` awesome list, archived on 2026-10-09. | Users cannot find an app to start from. |
| `downloadReadyAppSnapshot` buffers the whole tarball with no cap (`ready-apps.ts:350`), and `extractTarballSnapshot` calls `tar.x` with defaults (`:440-444`). | A large or odd archive is not bounded. Links and special entries are extracted. |
| `findTemplateFiles` walks the tree with `statSync` (`ready-apps.ts:402`), which follows links. | A link in an archive can make validation read outside the target, or abort with ELOOP or ENOENT. |
| A failed import leaves a half-filled target directory (`index.ts:738`, no cleanup). | The user must delete it by hand before retrying, because the CLI refuses an existing directory. |
| An imported app records no source repo or sha. | A created app cannot say where it came from. |
| `--registry` and `--verdaccio` are validated but not applied to imported apps (`index.ts:719-742`). | The flags do nothing for an import and say nothing about it. |

---

## Amendments (umbrella decision D3)

This section is the explicit amendment the umbrella spec asks for. Each change applies to `--template` only, except
A-5 (archive limits), which applies to the shared fetch and therefore also narrows `--app` and `--app-url`.
Outside these points `--app` and `--app-url` keep their contract unchanged.

### Ready Apps spec (`.ai/specs/implemented/2026-03-02-ready-apps-framework.md`)

| # | Rule today | Amendment for `--template` |
|---|---|---|
| A-1 | "App names are kebab-case slugs and MUST map directly to repository names without additional lookup tables in v1" (CLI Interface) | `--template <slug>` resolves the slug through the catalog index `templates.json`. The rule stays for `--app`. |
| A-2 | "The CLI MUST NOT rewrite dependency versions, package names, or application source files inside fetched ready apps" (Imported App Snapshot Contract) | `--template` rewrites the `name` field of the root `package.json` to the app name, unless `--keep-name` is given. Dependency versions and source files are still never rewritten. |
| A-3 | "The CLI MUST extract the fetched ready app into the target directory as a raw source snapshot" (Imported App Snapshot Contract) | `--template` adds one field, `openMercatoTemplate`, to the root `package.json` (provenance) and removes the root `mercato-template.json` after reading it. Nothing else in the snapshot changes. |
| A-4 | (none) | When a `--template` import fails after the CLI created the target directory, the CLI removes that directory. `--app` and `--app-url` keep today's behavior. |
| A-5 | (none; the fetch has no limits) | The shared fetch used by `--app`, `--app-url` and `--template` enforces the archive limits in "Untrusted archives". An archive that breaks a limit fails the import. This narrows `--app` and `--app-url`; see "Backward Compatibility". |

**Index design note.** The Ready Apps spec rejects a "centralized official repo such as `open-mercato/ready-apps`"
(Alternatives Considered), because one repo holding many apps couples their releases, CI and ownership. The catalog
index is not that: `templates.json` holds no code, only a pointer per template (`github`, `ref`, the selected sha)
plus curated status and computed facts. Each template stays in its own repo, owned by its author, which is the
model the Ready Apps spec chose. The index is the discovery layer the same spec proposes as the mitigation for
"Organization-level discovery becomes weaker without one central catalog repo" ("Maintain a documentation index").
It adds a trust decision, which the CLI makes visible: it prints `owner/repo@sha` and the verification state before
any download, binds facts to that sha, and accepts an index URL only over https or loopback.

**Manifest removal.** `mercato-template.json` (umbrella "In-repo manifest") describes the template, not the new
app. The CLI reads `schema`, `env` and `openMercato` from it, ignores unknown fields, and deletes the file, so a
created app never claims to be the template it came from. The catalog YAML stays the source of truth; the manifest
is a hint.

### `packages/create-app/AGENTS.md`

| Rule today | Amendment |
|---|---|
| Always 7: "MUST preserve imported ready apps as raw source snapshots: `--app` / `--app-url` imports may add only bootstrap-safe generated artifacts (for example `.mercato/generated/module-package-sources.css`)" | Add: "`--template` imports may also rewrite the root `package.json` `name` (unless `--keep-name`), add its `openMercatoTemplate` provenance field, and remove the root `mercato-template.json`. Nothing else." |
| Never: "Never rewrite package versions, source files, or inject agentic setup files into imported ready apps." | Add: "The only exceptions are the three `--template` edits of Always 7." |
| Ready App Import Modes: three modes, `--app` and `--app-url` mutually exclusive | Add mode 4, `--template <slug or owner/repo>[#ref]`, its exclusions, the hold policy, the archive limits for all imports, and the cleanup rule. Note that `--template` imports an app template and never runs `.template` placeholder processing (umbrella D1: code terms stay). |

The Ask First line "Ask before changing scaffold modes, ready-app import behavior ..." is satisfied by the umbrella
decisions D3, A5 and A8, taken by the decision owners on 2026-10-29.

---

## Proposed Solution

### CLI surface

```
create-mercato-app <app-name> --template <slug | owner/repo>[#ref] [--keep-name]
```

- `<slug>`: a curator slug from the index, `^[a-z0-9-]+$` without leading or trailing hyphens (the existing
  `validateSlug` rule).
- `owner/repo`: a GitHub path. Owner `^[A-Za-z0-9-]{1,39}$`, repo `^[A-Za-z0-9._-]{1,100}$`, not `.` or `..`.
  Matched against the index case-insensitively (catalog paths are lower case).
- `#ref`: a branch, tag or sha, everything after the first `#`, non-empty. Resolved through the GitHub API.
- A URL (`https://github.com/...`) is refused with a hint to use `owner/repo` or `--app-url`.
- `--keep-name`: keep the template's `package.json` `name`. Without `--template` it is a usage error.

Exclusions, checked before any network call (umbrella: "Mutually exclusive with ..."):

| Combined with `--template` | Result |
|---|---|
| `--app`, `--app-url` | Error: one source flag only (extends today's `--app` / `--app-url` check). |
| `--modules`, `--module-picker` | Error, as for `--app` / `--app-url` today. `--no-module-picker` is accepted and changes nothing. |
| `--preset <id>` other than `classic` | Error, today's import rule. `--preset classic` is accepted and changes nothing. |
| `--agents` (any value), `--experimental-hooks-validator` | Error, as for imports today. `--skip-agentic-setup` is accepted, as for `--app` today. |
| `--registry`, `--verdaccio` | Accepted with a warning: they do not apply to imported apps. |

With `--template` there is no preset prompt, no default module picker (`shouldOfferModulePicker` returns false, as
for `--app` / `--app-url`) and no agentic wizard. Git init (`--init-git`, prompt) is unchanged.

### Flow

```
parseArgs()                      + --template, --keep-name
  |
validate exclusions              no network yet
  |
resolveTemplatesUrl()            OM_TEMPLATES_URL: https or loopback, else usage error
fetchTemplatesIndex()            4 s timeout, one retry after a network error or 5xx (as picker.json)
  |
parseTemplateArg() + findTemplateEntry()
  |- slug, index unavailable     error, suggests --template owner/repo
  |- slug, not in index          error "no template with slug <slug>"
  |- listed, status hold         error with the reason, no override
  |- listed, unknown status      error (fail closed)
  '- owner/repo not in index     "not listed, not verified" (or "catalog status unknown" when unreachable)
  |
selectTemplateSha()              one sha, its facts or none (see "One sha, its own facts")
  |
print "Template: owner/repo@<sha> (verified | not verified)" + page URL when listed + pre-download notices
  |
downloadRepositoryTarball(sha)   shared fetch, streamed with a byte cap
  |
mkdir target (not recursive)     from here on, any failure removes the target directory
inspect + extract                archive limits, files and directories only
validateImportedReadyAppSnapshot lstat walk, no .template files (existing rule)
  |
finalizeTemplateApp()            read + remove mercato-template.json, name rewrite, provenance
compatibility + Enterprise notices (from the lockfile when no catalog facts apply)
  |
git init (unchanged) -> next steps with cp .env.example .env and declared env keys
```

### Index

- URL: `https://modules.openmercato.com/templates.json`, for a slug and for `owner/repo` alike. The CLI uses this one
  host, never `templates.openmercato.com`.
- Override: `OM_TEMPLATES_URL`. Accepted when the URL is `https:` (any host) or `http:` on a loopback host
  (`localhost`, `127.0.0.1`, `[::1]`, any port). Anything else is a usage error before any request; the CLI never
  falls back to the default URL on a bad override.
- The request carries `accept: application/json` and never `GITHUB_TOKEN`.
- Same fetch contract as `picker.json` (`fetch-catalog.ts`): `AbortSignal.timeout(4000)`, one retry after a network
  error or a 5xx, a 4xx or an unsupported body is final.
- Parsing: `schema` must be `1`, else the index counts as unavailable. Entries without a valid `github` or `status`
  are dropped. An entry without a valid `source.sha` (40 hex characters) is kept with `source: null`, so the hold
  policy still applies to it; it is never read as unlisted. Strings lose control characters before printing (the
  picker's `printable` helper).
- An entry `ref` is kept only when it is safe to print in a shell command: `^[A-Za-z0-9._/-]{1,255}$`, no `..`, no
  leading `-`. Otherwise it is read as `null` (the default branch). The `#<ref>` hint after a gone index sha applies
  the same rule to the default branch read from GitHub, and prints `<branch or tag>` when it fails.
- Duplicate slugs or duplicate `github` paths in one index (emit guarantees neither) make that lookup fail with a
  clear message instead of picking one.

### One sha, its own facts

| Case | Sha | Facts shown |
|---|---|---|
| Listed, no `#ref`, `verified` present | `verified.sha` | `verified.facts`, marked verified |
| Listed, no `#ref`, no `verified` | `source.sha` | `source.facts`, "not verified" |
| Listed, `#ref` | the ref resolved through the GitHub API | `verified.facts` or `source.facts` only when the sha equals that entry's sha; otherwise "not verified, no catalog facts for <sha>" and facts come from the downloaded lockfile |
| Unlisted (or index unreachable, `owner/repo` only), no `#ref` | default branch from `GET /repos/{o}/{r}`, then resolved to a sha | none; facts come from the downloaded lockfile |
| Unlisted, `#ref` | the ref resolved through the GitHub API | none; as above |

- Ref resolution: `GET {api}/repos/{owner}/{repo}/commits/{ref}`, reading `sha`. A 404 is "ref not found" with the
  repo and ref named; access, rate-limit and network errors reuse the existing `ready-apps.ts` messages.
- The tarball is always downloaded by sha (`GET {api}/repos/{owner}/{repo}/tarball/{sha}`), so the code is exactly
  the sha that was printed.
- If the selected catalog sha (`verified.sha` or `source.sha`) cannot be downloaded (404), the CLI stops and
  suggests `--template <owner/repo>#<ref>` with the entry's `ref` (or the default branch). It never switches to
  other code on its own.
- A `#ref` never inherits another sha's verification.

### Hold policy (umbrella, unchanged)

- `--template <slug>` and `--template owner/repo` refuse every entry the index lists as `hold`, printing its
  `reason`. No flag overrides it.
- `unmaintained` entries work and print their `reason` before the download.
- `delisted` entries are absent from the index, so they behave as unlisted repos.
- An entry with a status this CLI does not know is refused like `hold` (fail closed), with a hint to update
  `create-mercato-app`.
- Both refusals come before the sha selection, so they also apply to an entry without a valid `source.sha`. An
  allowed entry with neither `verified.sha` nor `source.sha` stops without `#ref` and suggests `#<branch or tag>`;
  with `#ref` it resolves as a listed `#ref` with no catalog facts.
- `--app-url` stays the uncurated path: it does not read the index and is not affected by the hold policy.

### Untrusted archives (shared fetch: `--app`, `--app-url`, `--template`)

The archive is third-party data. The umbrella sets the catalog's own tarball limits as the starting point
(`lib/sources/tarball.ts`: 50 MB unpacked, 5,000 files) and leaves the final numbers to this spec. Measured on
2026-11-04:

| Sample | Compressed | Entries | Unpacked |
|---|---|---|---|
| `open-mercato/ready-app-oss-prm` at HEAD (the only ready app) | 19.1 MB | 392 (283 files) | 21.2 MB |
| The scaffold, `packages/create-app/template` + `agentic` before install | (not packed) | about 720 files | about 26 MB |

Limits (constants in `safe-archive.ts`, no env override in v1):

| Limit | Value | Why |
|---|---|---|
| Download size | 64 MiB, streamed | Above the catalog's 50 MB unpacked limit plus tar header overhead, so a listed template never fails here. About 3.3 times the PRM archive. |
| Entries (files and directories) | 10,000 | Twice the catalog's 5,000 files, so directories cannot push a listed template over. About 25 times PRM. |
| Unpacked size (sum of file sizes) | 128 MiB | Twice the download cap; more than twice the catalog limit. About 6 times PRM. |

The catalog stays stricter than the CLI on purpose: a template that passes catalog validation always imports, and
the caps only stop archives that no catalog entry could hold.

Rules:

- The response body is read as a stream into a temporary file, counting bytes; a `content-length` above the cap or
  the running count passing it aborts the request. Nothing is buffered whole.
- Pass 1 lists the archive with the `tar` `Parser` (strict) without writing anything. It fails on: more entries
  than the cap, a sum of file sizes above the cap, any entry type other than file or directory (symbolic link,
  hard link, character or block device, FIFO, contiguous or unknown types), an absolute path, a drive letter, or a
  `..` segment. The error names the first offending path and the rule. Pax and GNU metadata headers are not
  entries.
- Pass 2 extracts with `strip: 1`, `strict: true`, `preservePaths: false`, `preserveOwner: false`, and a filter
  that admits only files and directories (defense in depth after pass 1).
- The target directory is created with a non-recursive `mkdirSync` right before pass 2, so a directory that
  appeared since the existence check fails the import instead of being written into or removed.
- Validation after extraction walks the tree with `lstatSync`, never `statSync`, and fails on any entry that is not
  a regular file or a directory. `findTemplateFiles` moves to the same walk.

### Compatibility and Enterprise notices (A5, D5)

- **Pinned line.** From the catalog facts when they apply (`facts.omLine`); otherwise from the downloaded tree, in
  this order: the `@open-mercato/core@npm:...` resolution in `yarn.lock` (read with a line scanner, no YAML
  dependency), the `@open-mercato/core` range in `package.json`, the manifest `openMercato`. The source is named in
  the notice.
- **Latest stable line.** `GET https://registry.npmjs.org/-/package/@open-mercato/core/dist-tags`, the `latest`
  tag reduced to `major.minor`. 4 s timeout, no retry. The CLI's own version is not used (A5: it changes nothing for
  an import).
- **Warning.** When the two lines differ: `Built on Open Mercato <pinned>; the latest stable line is <latest>.`
  With catalog facts and no npm answer, `linesBehind > 0` gives `Built on <pinned>, <n> line(s) behind the latest
  stable line.` Without either source: `Could not check the Open Mercato line of this template.` Always a warning,
  never a stop; no `--strict` in v1.
- **Enterprise.** From `facts.requiresEnterprise` when catalog facts apply; otherwise true when `yarn.lock` resolves
  any `@open-mercato/enterprise@` package. Notice: `This template depends on @open-mercato/enterprise, which needs
  an Open Mercato Enterprise license.`

### Finalizing the created app

- **Manifest.** If the root `mercato-template.json` exists, the CLI reads it (at most 256 KiB), uses `env` (name,
  description, optional link) and `openMercato` when `schema` is `1`, ignores unknown fields, and deletes the file.
  A file that does not parse, or has another `schema`, gives a notice and is deleted unread.
- **Name.** The root `package.json` `name` becomes the app name (the target directory's basename, already a valid
  slug), unless `--keep-name`. A missing or unparsable `package.json` fails the import (and the cleanup runs).
- **Provenance.** `"openMercatoTemplate": {"repo": "<owner>/<repo>", "ref": "<ref>", "sha": "<sha>"}` is added as
  the last key of the root `package.json`. `repo` is the index `github` for a listed repo, else the path as typed.
  `ref` is the `#ref` when given, else the entry's `ref` (listed) or the resolved default branch. The file is
  written back with its detected indentation and trailing newline; key order is kept.
- **Bootstrap artifact.** `.mercato/generated/module-package-sources.css` as for every import (Always 7).
- **Cleanup.** Any failure from the target `mkdir` to the end of finalizing removes the target directory
  (`rmSync` recursive). Failures before the `mkdir` leave nothing to remove. Interrupting the process (Ctrl+C) is
  not covered in v1.

### Next steps (`--template`)

```
Next steps:

  cd my-app
  cp .env.example .env
  # Fill in the keys this template declares:
  #   OPENAI_API_KEY  Used by the AI assistant.  https://platform.openai.com/api-keys
  yarn install
  yarn initialize
  yarn dev

Created from the app template owner/repo@<sha> (recorded in package.json "openMercatoTemplate").
If you want agentic tooling in the app later, run `yarn mercato agentic:init` inside it.
```

The `cp` line is printed only when `.env.example` exists; the env block only when the manifest declares keys.
`--app` / `--app-url` next steps are unchanged.

### Help and the `--app` miss (A8)

- Help gains `--template` and `--keep-name` with two examples (`--template crm`, `--template owner/repo#v1.0.0`).
- The broken `--app prm` example is removed from help, the README and `packages/create-app/AGENTS.md`; `--app` stays
  documented.
- When `--app <name>` finds no `open-mercato/ready-app-<name>` repo, the error adds:
  `Ready apps are now app templates: see https://modules.openmercato.com/templates or use --template <owner/repo>.`

---

## Architecture

- **No new dependency.** `tar` (already a dependency) for parsing and extraction, global `fetch`, `node:fs`.
- **Code layout.** `src/lib/safe-archive.ts` holds the limits and the two passes and is called by
  `ready-apps.ts`, so every import shares it. `src/lib/templates/` holds the index, resolution, compatibility and
  finalizing code. `index.ts` only parses flags, checks exclusions and calls one `scaffoldFromTemplate` function.
- **Terms (umbrella D1).** User-facing text says "app template"; code keeps `TEMPLATE_DIR`, `scaffoldTemplateApp`
  and `.template` for the scaffold. New identifiers use `appTemplate` / `templates` prefixes in their own folder.
- **Catalog rule 9.** No identifier, flag or JSON key added here uses the words `catalog` or `directory`.
- **Trust.** The CLI never runs code from the template. Facts are bound to one sha. `GITHUB_TOKEN` goes only to the
  GitHub API base, as today.

---

## Data Models

No database entities. Consumed and produced files:

```ts
// packages/create-app/src/lib/templates/types.ts (consumed, umbrella "API Contracts", schema 1)
export type TemplateEnvKey = { name: string; description: string; link?: string }

export type TemplateFacts = {
  omLine: string | null
  omVersion: string | null
  linesBehind: number | null
  requiresEnterprise: boolean
  engines: { node?: string } | null
  env: TemplateEnvKey[]
  // modules: read by the catalog pages, ignored by the CLI
}

export type TemplateStatus = 'active' | 'hold' | 'unmaintained' | 'unknown'

export type TemplateIndexEntry = {
  slug: string | null
  github: string                 // 'owner/repo', lower case
  status: TemplateStatus         // 'unknown' when the index has a value this CLI does not know
  reason: string | null
  useCase: string
  summary: string
  ref: string | null             // null when missing or not shell-safe (see "Index")
  source: { sha: string; syncedAt: string; facts: TemplateFacts | null } | null  // null without a valid sha
  verified: { sha: string; at: string; omVersion: string; importer: string; facts: TemplateFacts | null } | null
}

export type TemplatesIndex = { schema: 1; generatedAt: string; templates: TemplateIndexEntry[] }
```

- In-repo manifest `mercato-template.json`: the CLI reads `schema`, `env`, `openMercato` only (umbrella "In-repo
  manifest"), then removes the file.
- Provenance in the created app's `package.json`: `openMercatoTemplate: { repo: string; ref: string; sha: string }`.

---

## API Contracts

No HTTP API of the app changes. External surfaces:

| Surface | Contract |
|---|---|
| CLI flags | Additive: `--template <slug or owner/repo>[#ref]`, `--keep-name`. |
| Env | Additive: `OM_TEMPLATES_URL` (https or loopback). Existing: `GITHUB_TOKEN`, `OM_CREATE_APP_GITHUB_API_BASE_URL`. |
| `templates.json` | Read only, schema 1, published by `open-mercato/modules` (Phase 1a). Unknown fields ignored. |
| GitHub REST | `GET /repos/{o}/{r}`, `GET /repos/{o}/{r}/commits/{ref}`, `GET /repos/{o}/{r}/tarball/{sha}`. |
| npm registry | `GET https://registry.npmjs.org/-/package/@open-mercato/core/dist-tags`, read only. |
| Created app | `package.json` `openMercatoTemplate` field (committed with the app). |

---

## Edge Cases

| Case | Behavior |
|---|---|
| `--template crm`, index unreachable or unsupported | Error: catalog unavailable, suggests `--template <owner/repo>`. No fallback to `--app`. |
| `--template crm`, no such slug | Error naming the slug and the templates page. |
| `--template owner/repo`, index unreachable | Continues with `catalog status unknown, not verified`. |
| `--template owner/repo`, not in a reachable index | Continues with `not listed, not verified`. |
| Listed entry on `hold` (by slug or `owner/repo`) | Error with the reason. |
| Listed `#ref` that resolves to an unknown sha | `not verified, no catalog facts for <sha>`; notices from the lockfile. |
| `verified.sha` or `source.sha` returns 404 | Stop; suggest `#<ref>`. |
| Private repo without `GITHUB_TOKEN` | Existing access error with the `GITHUB_TOKEN` hint. |
| Archive over a cap, or with a link, device, FIFO, `..` or absolute path | Import fails naming the limit or the path; for `--template` the target directory is removed. |
| Archive with `.template` files | Existing fail-closed rule; for `--template` the target directory is removed. |
| Template without `package.json` | Import fails; target removed. |
| Template without `yarn.lock` | Line read from `package.json` or the manifest, with the source named. |
| `mercato-template.json` broken or `schema: 2` | Notice; the file is removed; no env keys printed. |
| `--keep-name` without `--template` | Usage error. |
| `OM_TEMPLATES_URL=http://example.com/...` | Usage error before any request. |
| npm registry unreachable | Notice; the import continues. |

---

## Implementation Plan

Step 1 is this spec. Steps 2 to 6 follow the umbrella "Phase 4" list. Each step is one commit or a small group of
commits on `feat/create-app-template`, with its tests green before the next step.

### Step 2: index, resolution, hold policy, exclusions (done)

- New `src/lib/templates/types.ts`, `fetch-templates.ts` (`DEFAULT_TEMPLATES_URL`, `TEMPLATES_URL_ENV`,
  `resolveTemplatesUrl`, `parseTemplatesIndex`, `fetchTemplatesIndex`), `resolve-template.ts` (`parseTemplateArg`,
  `findTemplateEntry`, `selectTemplateSha`, `describeTemplateSelection`).
- `ready-apps.ts`: export `resolveGitHubCommitSha` and `resolveGitHubDefaultBranch` over the existing request and
  error helpers.
- `index.ts`: `Options.template`, `Options.keepName`, `parseArgs`, the exclusion checks, `shouldOfferModulePicker`
  and `resolveStarterPresetId` treat `--template` like an import, and the `owner/repo@sha` line.
- Fixture `src/lib/templates/__fixtures__/templates.json` in the umbrella shape: active with and without
  `verified`, `hold` with a slug and a reason, `unmaintained`, an unknown status, an entry without a slug.
- Docs: "Amended by" note in the Ready Apps spec changelog; mode 4 in `packages/create-app/AGENTS.md` "Ready App
  Import Modes" (within the instruction budget, `yarn agents:check-budget`).
- Tests (mocked index and GitHub, no network): `OM_TEMPLATES_URL` accepted for https and loopback, refused for
  `http://example.com`; schema 2 and malformed entries; slug and `owner/repo#ref` parsing, URL refused; listed
  without `#ref` picks `verified.sha`, then `source.sha` when `verified` is missing; `#ref` to an unknown sha has no
  facts; `#ref` equal to `source.sha` keeps its facts; unlisted public and private repos resolved through the
  default-branch API (private with `GITHUB_TOKEN` in the request); unreachable index with `owner/repo` continues and
  with a slug fails; refusal by the retained slug and by `owner/repo` with the hold reason; unknown status refused;
  `unmaintained` continues with its reason; every exclusion in the table fails before any request; the default
  picker is not offered with `--template`.

### Step 3: archive limits in the shared fetch (done)

- New `src/lib/safe-archive.ts`: `ARCHIVE_LIMITS`, `readCappedBody` (streamed to a temporary file),
  `inspectArchive` (pass 1), `extractArchive` (pass 2), `assertRegularTree` (lstat walk).
- `ready-apps.ts`: `downloadReadyAppSnapshot` streams through `readCappedBody`; `extractTarballSnapshot` calls the
  two passes and creates the target non-recursively; `findTemplateFiles` uses `lstatSync`. Add
  `downloadRepositoryTarball(owner, repo, sha)` for `--template`.
- Tests: fixtures with a symlink, a hard link, a self-link, a FIFO entry, an absolute path, a `..` path, an
  archive over the download cap (streamed body and `content-length`), too many entries, and an unpacked size over
  the cap; each fails with a message naming the rule and, where there is one, the path; nothing is written into the
  target on a pass 1 failure; the existing `--app` and `--app-url` tests stay green; a normal GitHub-style archive
  still extracts with the root folder stripped.

### Step 4: compatibility, "not verified" and Enterprise notices (done)

- New `src/lib/templates/compat.ts`: `readPinnedCoreVersion` (yarn.lock, then package.json, then manifest),
  `lineOf`, `fetchLatestStableLine` (npm dist-tags, injectable fetch), `compatibilityNotice`,
  `requiresEnterpriseFromLockfile`, `enterpriseNotice`.
- Tests with mocked tarballs at different lines: a template on the latest line prints no warning; one line behind
  shows both lines; catalog facts win over the lockfile when the sha matches; an unlisted repo takes the line from
  its lockfile and prints `not listed, not verified`; no `yarn.lock` falls back to `package.json`; npm unreachable
  with facts uses `linesBehind`, without facts prints the "could not check" notice; Enterprise from facts and from a
  lockfile with `@open-mercato/enterprise`.

### Step 5: finalizing, cleanup, next steps, registry warning (done)

- New `src/lib/templates/finalize.ts`: `readTemplateManifest`, `finalizeTemplateApp` (manifest removal, name
  rewrite, provenance), `printTemplateImportNextSteps`.
- New `src/lib/templates/template-step.ts`: `scaffoldFromTemplate(targetDir, appName, options, deps)` wiring steps 2
  to 5, with the cleanup on failure.
- `index.ts`: call `scaffoldFromTemplate`; the `--registry` / `--verdaccio` warning for `--template`.
- `packages/create-app/AGENTS.md`: Always 7 and the Never line as in "Amendments".
- Tests: name rewritten and kept with `--keep-name`; provenance for listed with and without `#ref` and for unlisted;
  indentation and key order kept; manifest removed in every case (valid, broken, `schema: 2`); declared env keys in
  the next steps and the `cp` line only with `.env.example`; target removed after a failure in extraction, in
  `.template` validation and in finalizing; target kept when the failure is before the `mkdir`; an existing target
  is never removed; the registry warning printed for `--template` and not for `--app-url`; an end-to-end CLI run
  (spawned `index.ts` with a mocked `fetch`, as the existing `--app` CLI test) creates a working tree.
- Integration case in `scripts/test-create-app-integration.ts` (see "Test & Integration Coverage").

### Step 6: docs and help (done)

- Help: `--template`, `--keep-name`, two examples; the `--app prm` example removed.
- `packages/create-app/AGENTS.md`: mode 2 reads `--app <name>` instead of the broken `--app prm` example.
- `packages/create-app/README.md` and `apps/docs/docs/customization/standalone-app.mdx`: a `--template` section, the
  hold and verification messages, the archive limits, the `--app prm` example removed.
- The `--app` miss hint (A8) in `downloadReadyAppSnapshot` for an official repo that does not exist.
- Agent guide for the save tool: `packages/create-app/agentic/guides/template-tool.md` (save with
  `create-mercato-template`, create with `--template`), linked from `agentic/guides/architecture.md`. A row in the
  generated root `AGENTS.md` only if `agent-instruction-budget.test.ts` keeps passing.
- Mark this spec's steps done and update the changelog.
- Tests: help output contains the `--template` line and examples and no `--app prm`, nor do the README and
  `packages/create-app/AGENTS.md`; the miss hint for a missing
  official repo; a guide test like `module-tool-guidance.test.ts` (the guide exists and is linked).
- As built: the help and README examples are `--template crm` and `--template some-agency/b2b-portal#v1.0.0`. The
  miss hint is the exported `READY_APP_MISS_HINT`, added only when the official repo does not exist; a missing
  compatibility tag keeps today's message. The routing row in the generated root `AGENTS.md` was added, and
  `agent-instruction-budget.test.ts` still passes. The guide test is `src/lib/template-tool-guidance.test.ts`. The
  docs options table also gained the `--app` and `--app-url` rows it lacked.

---

## Exact File Inventory

| # | File | Step | Action |
|---|------|------|--------|
| 1 | `.ai/specs/2026-11-04-create-app-template-flag.md` | 1, 6 | new, then progress |
| 2 | `packages/create-app/src/lib/templates/types.ts` | 2 | new |
| 3 | `packages/create-app/src/lib/templates/fetch-templates.ts` | 2 | new |
| 4 | `packages/create-app/src/lib/templates/resolve-template.ts` | 2 | new |
| 5 | `packages/create-app/src/lib/templates/__fixtures__/templates.json` | 2 | new |
| 6 | `packages/create-app/src/lib/templates/templates.test.ts` | 2, 4, 5 | new |
| 7 | `packages/create-app/src/lib/ready-apps.ts` (+ `ready-apps.test.ts`) | 2, 3, 6 | edit |
| 8 | `packages/create-app/src/lib/safe-archive.ts` (+ `safe-archive.test.ts`) | 3 | new |
| 9 | `packages/create-app/src/lib/templates/compat.ts` | 4 | new |
| 10 | `packages/create-app/src/lib/templates/finalize.ts`, `template-step.ts` | 5 | new |
| 11 | `packages/create-app/src/index.ts` | 2, 5, 6 | edit |
| 12 | `scripts/test-create-app-integration.ts` | 5 | edit |
| 13 | `packages/create-app/AGENTS.md` | 2, 5 | edit |
| 14 | `.ai/specs/implemented/2026-03-02-ready-apps-framework.md` | 2 | edit (changelog note) |
| 15 | `packages/create-app/README.md`, `apps/docs/docs/customization/standalone-app.mdx` | 6 | edit |
| 16 | `packages/create-app/agentic/guides/template-tool.md`, `agentic/guides/architecture.md` | 6 | new, edit |
| 17 | `packages/create-app/src/lib/template-tool-guidance.test.ts` | 6 | new |
| 18 | `packages/create-app/agentic/shared/AGENTS.md.template`, `packages/create-app/template/AGENTS.md` | 6 | edit (one routing row) |
| 19 | `UPGRADE_NOTES.md` | 3 | edit (the `--app` / `--app-url` narrowing) |

---

## Test & Integration Coverage

### Unit tests (`cd packages/create-app && node --import tsx --test <files>`)

The full list is in the step descriptions above. Summary by area:

- Index: URL override rule, schema check, dropped entries, duplicate slug or path, sanitized strings, timeout and
  retry (shared with the picker contract).
- Resolution: slug and `owner/repo#ref` parsing; sha selection for every row of "One sha, its own facts"; hold,
  unknown status and `unmaintained`; unlisted public and private repos; unreachable index; the catalog sha 404 stop.
- Exclusions: every row of the exclusion table, before any request; no default picker with `--template`.
- Archive: symlink, hard link, self-link, FIFO, absolute path, `..`, download cap (stream and header), entry cap,
  unpacked cap; lstat walk; existing imports unchanged.
- Notices: line comparison from facts, lockfile, `package.json`, manifest; npm unreachable; Enterprise from facts and
  lockfile.
- Finalizing: name rewrite and `--keep-name`, provenance, manifest removal, next steps, cleanup on failure, registry
  warning.
- CLI: one spawned end-to-end `--template` run with a mocked `fetch`; help output.

### Integration test (`yarn test:create-app:integration`)

Added to `scripts/test-create-app-integration.ts`, after the standalone scaffold and before its `yarn install`:

1. Copy the scaffolded app into a fixture tree (it has no `node_modules` or `.env` yet), add a
   `mercato-template.json` with one declared env key, and pack it as a GitHub-style tarball.
2. Start a local HTTP server on `127.0.0.1` (random port) that serves `/templates.json` (one active entry with a slug
   and `source.sha`, one `hold` entry) and the three GitHub API routes for the fixture repo.
3. Run `create-mercato-app <dir> --template <slug> --skip-agentic-setup` with `OM_TEMPLATES_URL` and
   `OM_CREATE_APP_GITHUB_API_BASE_URL` pointing at the server.
4. Assert: `package.json` `name` is the new app name, `openMercatoTemplate` has the fixture repo and sha,
   `mercato-template.json` is gone, `.yarnrc.yml` still points at Verdaccio (raw snapshot), the next steps list the
   env key, and the output shows `<owner>/<repo>@<sha>`.
5. Run the `hold` slug and assert the refusal with its reason and no target directory.
6. In the created app: `yarn install` and `yarn generate` succeed. No second build, to keep the lane time.

The script packs the fixture with `tar` resolved from `packages/create-app` (`createRequire`), because the root
workspace does not declare `tar` and a hoisted copy is not a contract.

Not run in this branch: the script needs Verdaccio and free ports. It runs in the standalone CI lane.

---

## Backward Compatibility

| Surface | Impact | Handling |
|---|---|---|
| Default invocation, presets, module picker, agentic wizard | None | Untouched; `--template` is opt-in. |
| CLI flags (BACKWARD_COMPATIBILITY.md 13, STABLE) | Additive | `--template`, `--keep-name` added; no flag renamed or removed. |
| `--app` / `--app-url` imports | Narrowed by the archive limits (A-5) | An archive over 64 MiB, over 10,000 entries or 128 MiB unpacked, or with a link or special entry, now fails. Measured real apps are far below the caps (PRM: 19.1 MB, 392 entries). Links were never part of the snapshot contract. Listed in the release notes and `UPGRADE_NOTES.md` when the step ships. |
| `--app` miss message | Text only | Adds the templates hint (A8). |
| `templates.json` | External, read only | Schema 1; unknown fields ignored; unknown schema means unavailable. |
| Created app `package.json` | New field for `--template` only | `openMercatoTemplate` is additive and ignored by every tool. |

---

## Risks & Impact Review

| Risk | Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|---|
| Catalog as trust root | A squatted slug or a bad entry sends users to someone else's code. | High | Users of `--template <slug>` | Curator-only slugs (A6); `owner/repo@sha` and the verification state printed before download; facts bound to the sha; index only over https or loopback; hold refused. | A curator mistake still points a slug at bad code until fixed; the printed `owner/repo@sha` is the user's last check. |
| Archive bomb or link escape | A repo ships a huge archive, millions of entries, or a link that points outside the target. | High | Every import | Streamed byte cap, entry and unpacked caps, files and directories only, two passes, `lstat` walk. | A tree within the caps can still hold unwanted files; the CLI never runs them, `yarn install` is the user's step. |
| Narrowed `--app-url` | A legitimate external app is larger than the caps. | Low | `--app-url` users | Caps set at several times the measured apps and above the catalog limits; the error names the limit. | An unusual app needs trimming; no override in v1. |
| Index outage | `templates.json` unreachable during a workshop. | Medium | `--template <slug>` | `owner/repo` continues; the slug error suggests it; 4 s timeout with one retry. | Slug users must retype the command. |
| Stale or incompatible template | A template pins an old line. | Medium | Created apps | Compatibility warning with both lines; "not verified" until the Phase 1b smoke; `unmaintained` reason shown. | The user may continue on an old line by choice. |
| Paid dependency surprise | A template needs `@open-mercato/enterprise`. | Medium | License compliance | Enterprise notice from facts or the lockfile, before the next steps. | Notice only; the license decision stays with the user (D5). |
| Half-created app | Import fails mid-way. | Low | DX | Cleanup removes the target the CLI created; the non-recursive `mkdir` protects an existing directory. | Ctrl+C during extraction can still leave a partial directory. |
| Provenance or name rewrite breaks an app | A template depends on its own `package.json` `name`. | Low | Created apps | `--keep-name`; only `name` and one additive field change. | Scripts that read `name` need `--keep-name`. |
| Overlap with #8718 | Both touch `index.ts` flag parsing and `shouldOfferModulePicker`. | Low | Merge | This branch is based on #8718; rebase after it merges. | Small conflicts in `index.ts`. |

Rollback: `--template` is an additive flag; removing it before a stable release costs nothing, after one it needs a
deprecation notice. The archive limits can be raised by a patch release if a real app hits them.

---

## Final Compliance Report - 2026-11-04

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md` (section 13, CLI commands)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Ask before adding production dependencies | Compliant | None added; `tar` is already a dependency. |
| root AGENTS.md | Spec lists integration coverage for affected paths | Compliant | Integration case in `scripts/test-create-app-integration.ts`. |
| packages/create-app/AGENTS.md | Ask before changing ready-app import behavior | Compliant | Decided in the umbrella spec (D3, A5, A8) by its decision owners on 2026-10-29. |
| packages/create-app/AGENTS.md | Always 7 and Never: imported apps stay raw snapshots | Amended | For `--template` only, three named edits; see "Amendments". |
| packages/create-app/AGENTS.md | Never break the standalone app template | Compliant | The scaffold path is untouched. |
| Ready Apps spec | No lookup tables, no package name rewrite, raw snapshot | Amended | For `--template` only; `--app` / `--app-url` keep them. |
| BACKWARD_COMPATIBILITY.md 13 | MUST NOT rename or remove CLI flags | Compliant | Additive flags; the archive-limit narrowing is documented above. |
| .ai/specs/AGENTS.md | Required sections and naming | Compliant | `{date}-{title}.md`, all checklist sections present. |

### Verdict

Implemented. Ready for review.

---

## Open Questions

None blocking. Judgment calls made in this spec, open to reviewer override:

1. Archive caps: 64 MiB download, 10,000 entries, 128 MiB unpacked (above the catalog limits on purpose).
2. Latest stable line from the npm `latest` dist-tag of `@open-mercato/core`, not from the CLI version or the
   picker index.
3. An index entry with an unknown status is refused like `hold` (fail closed).
4. `--registry` / `--verdaccio` warn for `--template` only; `--app` / `--app-url` output stays as today.
5. `--skip-agentic-setup`, `--no-module-picker` and `--preset classic` are accepted with `--template`, matching the
   import rules today.
6. A URL given to `--template` is refused with a hint, not parsed.
7. A broken or `schema: 2` manifest is removed unread with a notice.
8. The compatibility notice names where the pinned line came from (catalog facts, `yarn.lock`, `package.json` or
   `mercato-template.json`), and "could not check" says which side is missing.
9. Without catalog facts and without `yarn.lock`, the Enterprise notice reads the `package.json` dependencies.
10. Catalog facts with no `omLine` fall back to the downloaded tree for the pinned line.
11. For a listed entry without `ref`, provenance `ref` is the default branch read after the download; if GitHub does not
    answer, the sha is recorded as `ref`.
12. Manifest env keys must match `^[A-Za-z_][A-Za-z0-9_]{0,127}$` and are listed once; a `link` is printed only when it
    is an http or https URL.
13. The integration case adds `--registry <Verdaccio>` to also check the warning and that `.yarnrc.yml` is unchanged.
14. The `--app` miss hint is added only when the official repo does not exist, as written above; a missing
    compatibility tag on an existing repo keeps today's message.
15. The `owner/repo#ref` example reads `some-agency/b2b-portal#v1.0.0`, after the existing `some-agency` example.
16. The agent guide links to `create-mercato-template` on GitHub and names the `npx --package github:...` fallback,
    because the package is not on npm yet (2026-11-04). It adds no harness case; the routing row is covered by the
    guide test only.
17. An index `ref` must match `^[A-Za-z0-9._/-]{1,255}$`, with no `..` and no leading `-`, else it reads as `null`.
    The `#<ref>` hint checks the default branch from GitHub with the same rule instead of shell-quoting it.
18. An entry without a valid `source.sha` is kept with `source: null` (refusal first). An allowed entry with neither
    sha stops without `#ref`; with `#ref` it resolves as a listed `#ref` without catalog facts.
19. The integration script resolves `tar` from `packages/create-app` instead of adding a root devDependency, so
    `yarn.lock` stays unchanged.

---

## Changelog

- 2026-11-04: Initial spec (Phase 4 step 1 of the Templates umbrella spec). Amends the Ready Apps spec and
  `packages/create-app/AGENTS.md` for `--template` only, sets the archive limits for the shared fetch from measured
  apps, and plans steps 2 to 6 with their tests.
- 2026-11-04: Steps 2 and 3 implemented (index, resolution, hold policy and exclusions; `safe-archive.ts` with the
  limits for every import, and the `UPGRADE_NOTES.md` entry for the `--app` / `--app-url` narrowing).
- 2026-11-04: Steps 4 and 5 implemented (`compat.ts`, `finalize.ts`, `template-step.ts`, the `--registry` warning,
  Always 7 and Never in `packages/create-app/AGENTS.md`, the integration case). Judgment calls 8 to 13 added.
- 2026-11-04: Step 6 implemented: `--template` and `--keep-name` in help with two examples, the `--app prm` example
  removed from help and the README, the `--app` miss hint (A8), the README and `standalone-app.mdx` sections, the
  agent guide `template-tool.md` with its routing row, and the guide test. Judgment calls 14 to 16 added. All steps
  are done.
- 2026-11-04: Review fixes: shell-safe index refs in the `#ref` hint, hold and unknown statuses refused for entries
  without a valid `source.sha`, the `--app prm` example removed from `packages/create-app/AGENTS.md`, a timeout test
  for the index, and `tar` resolved from `packages/create-app` in the integration script. Judgment calls 17 to 19
  added.
