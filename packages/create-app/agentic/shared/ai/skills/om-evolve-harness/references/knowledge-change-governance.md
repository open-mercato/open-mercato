# Knowledge-Change Governance

Load this authoritative checklist from `om-evolve-harness` or the repository's `om-refresh-standalone-harness` workflow whenever the Git-derived change class is `knowledge-contract`.

Unknown knowledge, routing, discovery, context-read, evaluator, or oracle changes fail closed to `knowledge-contract`. A byte-only generated/materialized refresh may use `asset-sync` only when the controller proves the authoritative semantics are unchanged and regenerated hashes match; it still requires a passing manifest.

## Mandatory seven-step contract

1. Name the changed knowledge contract, affected case IDs, and affected ranges in the authored manifest; empty affected sets are allowed only when the controller derives that they are inapplicable.
2. Add a focused evaluator, oracle, or read-policy test that fails against the resolved base plus only the test patch, and retain only sanitized fail-before evidence: exit status, output hashes, and tool/version facts.
3. Update the authoritative case or context policy and the evaluator implementation together so the semantic contract and its enforcement cannot drift.
4. Synchronize every mode-dependent surface that applies: `cases.json`, validators, writable AST/runtime oracles, release matrix, focused tests, catalog counts, README, RELEASE and spec documentation, and emitted or generated copies.
5. Prove the focused test passes at clean HEAD and run the affected certified lane; deterministic catalog validation alone is not affected-lane evidence.
6. Reject manual edits to derived copies and stale copies; reject completion while any authoritative or generated hash, catalog count, documentation reference, case/range membership, oracle, or release lane is stale.
7. Generate and pass the machine manifest with the controller-owned base/HEAD executions, then attach its sanitized result and hash to the affected-lane evidence without raw runner output or absolute paths.

## Command routing

Create the authored manifest from `knowledge-change.schema.json` without `resolvedBaseSha`, `headSha`, or `focusedExecutions`. Run the command for the current environment exactly as argv, without a shell-composed test command:

| Workflow | Command |
| --- | --- |
| Emitted standalone app | `yarn harness:validate-knowledge-change --manifest <path> --base <ref>` |
| Repository refresh | `yarn workspace create-mercato-app harness:validate-knowledge-change --manifest <path> --base <ref>` |

The controller requires a committed clean HEAD, derives the class, cases, catalog count, mode-required validators/oracles, release lanes, changed paths, and hashes from Git and the current harness, and atomically replaces the authored manifest with sanitized evidence. Do not author controller-owned evidence, manually soften the derived class, substitute a passing schema error for fail-before behavior, or claim completion after a non-zero controller result.

## Surface routing

- Knowledge/case policy: `.ai/harness/cases.json`, its schema and validator registry.
- Evaluator/read policy: emitted harness controller scripts and focused controller tests.
- Writable behavior: fixture index plus fixed AST/runtime oracles and narrow allowed writes.
- Certification: `.ai/harness/release-matrix.json` and the named affected lane.
- Derived assets: regenerate through their owning recursive emission/build path and declare source-to-copy hashes in `generatedFiles`.
- Documentation: harness README, RELEASE, affected feature spec, and count/range statements.

If any required surface is unavailable or cannot be proven from the clean base-to-HEAD range, stop with a blocker rather than omitting it from the manifest.
