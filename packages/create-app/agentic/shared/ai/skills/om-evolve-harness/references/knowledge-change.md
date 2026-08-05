# Knowledge-Change Contract

Load this reference before any harness edit. The class is machine-derived from the diff, never from intent.

## Classification

`knowledge-contract` — the change touches emitted/root agent instructions, authoritative skill/reference files,
the source-link inventory or parity ledger, discovery/generator contracts, evaluator or oracle code,
routing/context JSON in `cases.json`, the canonical example inventory, generated fact provenance/rendering, or
any exact source mapped by an affected case. Its `changedContracts` are drawn from
`routing`, `skill-link`, `source-link`, `example-source`, `installed-source`, `discovery`, `context-read`,
`evaluator`, `oracle`.

`asset-sync` — every changed path is a generated/materialized copy or a count/docs snapshot, every
`sourcePath` authoritative SHA is unchanged from the base, and regenerated hashes match exactly. It still runs
existing synchronization validation but needs no new behavior test.

Unknown paths fail closed to `knowledge-contract`. A declared class that differs from the derived class fails.

Moving, deleting, or semantically changing a linked file under `apps/mercato/src/modules/example/**`, its
byte-identical template mirror, or its emitted runtime-source counterpart is `example-source`. Changing a linked
package, package-relative target, version, export/publish set, or preset applicability is `installed-source`.
`__tests__/` and `__integration__/` entries under the example tree derive `readStatus: "qa-only"`: they are QA
evidence paths and cases may reference only `readable` source records.

## The nine mandatory steps

Every `knowledge-contract` change must complete all nine, in order:

1. Name the changed knowledge contract and the affected case IDs/ranges.
2. Inventory every emitted knowledge owner affected by the topic and classify it `source-required`,
   `self-authoritative`, `generated-fact`, or `retained-normative-snippet`; when replacing prior examples,
   update the finite `main` parity ledger.
3. Render visible exact-file links in each `source-required` owner and update the source-link inventory. An
   evaluator allowance, directory hint, wildcard, or manifest-only entry is not delivery.
4. Add a focused evaluator/oracle/read-policy test that fails for the old behavior; retain sanitized
   fail-before evidence.
5. Update the authoritative case/context policy and the evaluator implementation together.
6. Synchronize every mode-dependent surface: `cases.json`, validators, writable AST/runtime oracles, release
   matrix, focused tests, catalog counts, README/RELEASE/spec documentation, source-link/example inventories,
   generated facts, and emitted/generated copies.
7. Generate fresh applicable presets from a coherent build, install packed artifacts, resolve every
   local/installed link, and run every integration test declared by each added or materially changed example
   extension surface.
8. Prove the focused test passes and run the affected certified lane; reject completion when any
   authoritative/generated/packed hash, link, owner, baseline disposition, or count is stale.
9. Generate and pass the machine validation manifest; attach its sanitized result to the affected-lane evidence.

When the change adds a missing ordinary module surface, route it to the canonical
`apps/mercato/src/modules/example/**` authoring tree, materialize the byte-identical mirror with
`yarn template:sync:fix`, update the surface/source-link inventories and exact case links, add a self-contained
activated integration test, and run `yarn template:sync`. Never create a second teaching module and never
satisfy the case through installed-source fallback.

## Step 9 — the machine manifest

Author the run manifest against `.ai/harness/knowledge-change.schema.json` (monorepo:
`packages/create-app/agentic/shared/ai/harness/knowledge-change.schema.json`). Authored input MUST omit
`resolvedBaseSha`, `headSha`, and `focusedExecutions` — they are controller-owned output, and author-supplied
evidence fails validation.

```text
# monorepo
yarn workspace create-mercato-app harness:validate-knowledge-change --manifest <path> --base <ref>

# scaffolded standalone app
yarn harness:validate-knowledge-change --manifest <path> --base <ref>
```

Both invoke the same implementation. In a scaffolded app the script is installed by
`yarn mercato agentic:init`; before that it fails closed with exit code 2.

The validator resolves `--base`, requires the authored `baseRef` to resolve to the same SHA, derives the class
and contracts from the diff, and rejects a stale hash, a missing focused test, an unknown case ID or range, a
wrong catalog count, an absent release lane, an unresolvable documentation path, and — for `example-source` — a
moved/deleted linked file, a missing mirror, or mirror drift.

## Controller-owned base/head execution

For a `knowledge-contract` change the controller then proves the regression itself. For every path in
`focusedTestFiles` it:

1. derives the argv from the file extension — `node --test <file>` for `.mjs`/`.cjs`/`.js`, `node --import tsx
   --test <file>` for `.ts`/`.tsx`. The author never supplies a command, so a weaker one cannot be substituted.
   The controller first reads the nearest owning `package.json` `scripts.test`; it only drives a `node --test`
   runner, and **refuses by name** when the owning package declares another one (a scaffolded app on `jest` is
   refused rather than handed a command that would not run its suite — drive those focused tests manually and
   attach the evidence to step 8 until the controller learns that runner);
2. requires a real test-only diff — a focused test whose base and head contents are identical is rejected;
3. builds one throwaway `git worktree` at the base commit and copies in **only** that test's head content, and a
   second throwaway worktree at head carrying the whole working-tree diff. Neither run touches your checkout;
4. runs the argv **exactly once per side** — there is no retry and no shell — with the runner's own environment
   stripped (`NODE_OPTIONS`, `NODE_TEST_CONTEXT`, `NODE_V8_COVERAGE`, `TEST_RUNNER_CONCURRENCY`), and records
   `exitCode` plus `stdoutSha256`/`stderrSha256` for each side;
5. requires base-plus-test-only to exit **non-zero** and head to exit **zero**. A test that already passes at
   base proves nothing and fails the run, as does an execution record for a test the manifest never declared.

Use `--execution-timeout <ms>` (default 600000) when a lane legitimately needs longer. The completed manifest
written to the result file is re-validated against `#/$defs/completedManifest`, so its `focusedExecutions`,
`resolvedBaseSha`, and `headSha` are part of the attached evidence.

## Current gate: CANON-C

`source-link`, `example-source`, and `installed-source` runs require
`packages/create-app/scripts/source-links/source-link-inventory.json`. That inventory is owned by CANON-C
and **has landed in the monorepo**, so those three contracts resolve there. It is deliberately a
monorepo-only asset — `create-mercato-app`'s `files` field never publishes `scripts/` — so in a
**scaffolded app** it is absent and those runs derive their class normally and then fail closed with an
explicit `not present — CANON-C` reason. Do not work around that by re-declaring the class.

The validator is still deliberately **not** in `.ai/agentic.config.json` `validation.commands` or CI, but
no longer because the inventory is missing. Two reasons remain: the `sourceLinkInventory` block is an
existence check only — the seven declared count/hash/path fields are not yet read, so its numbers are
unverified — and focused tests owned by a jest/vitest package are refused rather than executed (see the
known limitation above), which is exactly what a scaffolded app ships. Run it by hand for step 9.
