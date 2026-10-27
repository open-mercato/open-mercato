# Catalog Refresh Procedure

## Deduplicate semantically

Load the complete catalog and compare each candidate against existing prompts, semantic decisions, required/forbidden context, validators, tags, risk, owners, and related cases. Title similarity alone is insufficient.

Choose exactly one disposition:

1. **Covered** — an existing assertion exercises the same invariant and failure mode. Link the existing case; do not add a variant.
2. **Expand** — the invariant is the same but an existing semantic assertion, tag, relation, or parameterized variant is incomplete. Strengthen that case.
3. **Add** — the candidate represents a distinct routing, decision, artifact, or behavioral failure. Add one contiguous `OMH-NNN` case.
4. **Evidence only** — no agent behavior or harness contract changes. Explain why no evaluation is warranted.

Do not merge distinct safety invariants merely to keep counts low. Do merge wording-only or entity/provider-only duplicates into parameterized coverage when the oracle and owner are identical.

## Failure first and one owner

For every **expand** or **add** disposition, follow the checked-in bundled procedure at:

```text
packages/create-app/agentic/shared/ai/skills/om-evolve-harness/SKILL.md
```

Its case workflow, case template, and owner-selection reference are authoritative. In particular:

1. Select one smallest primary owner for the evaluation, but do not change it yet.
2. Register the minimum schema-valid runnable evaluation and its required catalog metadata.
3. Run it against the unchanged owner. Retain a sanitized semantic failure; schema/catalog invalidity is not failure-first evidence.
4. For `implementation` or `regression`, require a fresh disposable scaffold and fixed controller-owned oracle that fails before and passes after. If no trustworthy fixture/oracle exists, report a blocker; do not downgrade a behavioral claim into a routing pass.
5. Update only the chosen owner. Secondary files reference it rather than duplicate its rule.
6. Rerun the target case, related cases/tags, mandatory safety coverage, budget/consistency gates, and scaffold smoke required by the bundled procedure.

## Synchronize the release contract

Review and update together when applicable:

- `cases.json`, contiguous IDs, schemas, validator registry counts/sets, and semantic validators;
- related-case links and mandatory safety classification;
- `release-matrix.json` only for a justified release lane;
- fixture/seed indexes, fixed oracles, and narrow `allowedWrites` for writable cases;
- the harness feature spec's numbered use cases and totals;
- harness README/counts and user-facing release instructions;
- focused evaluator/overlay/layout tests affected by the catalog change.

Do not edit generated assets by hand. Run the repository generator only when the changed source relies on auto-discovery or produces a required generated artifact.

## Validation order

Use the commands prescribed by the bundled case template for the target case, its runner, and its family. Then validate related tags and mandatory safety cases. From a fresh standalone scaffold generated from the refreshed local create-app sources (whose pre-edit baseline is `to`), run the deterministic catalog gate:

```text
yarn harness:validate --all
```

This is fast deterministic validation, not the per-release suite. Install the pinned skills and finish with the one command that executes the complete `release-matrix.json` contract:

```text
yarn install-skills
yarn harness:release --runner codex --prepare-targets /absolute/empty-release-targets --acknowledge-writes
```

The target directory must be absolute, new or empty, and outside the controller app. The release command must run on macOS with `/usr/bin/sandbox-exec` or Linux with Bubblewrap (`bwrap`) and available user namespaces; unsupported or unavailable containment fails closed. Require the schema-valid, mode-`0600` sanitized `*-release-suite.json` artifact under `.ai/harness/results/`, verify all required primary routing, writable oracle, target command, and generated-code-review lanes, and record only its status, hash, runner/model/tool versions, and sanitized unavailable reasons. A different `--portability-runner` is optional; omitted evidence is recorded as not requested, while unavailable primary or explicitly requested portability capacity blocks a complete release claim.
