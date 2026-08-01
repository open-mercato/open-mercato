# Reproducible Case Template

Use the next contiguous `OMH-NNN` ID. Copy an adjacent case from `.ai/harness/cases.json`, then fill this contract rather than inventing a second format:

```json
{
  "id": "OMH-NNN",
  "title": "Concrete user outcome",
  "family": "architecture|module|umes|integration|ai-workflow|bugfix|business|testing",
  "mode": "analysis|one-shot|spec|bugfix|review",
  "evaluationKind": "static|routing|implementation|regression",
  "risk": "low|medium|high",
  "prompt": "Standalone user request with observable scope",
  "tags": ["kebab-case"],
  "owner": { "kind": "root|guide|skill|facts|hook", "path": "app/relative/path", "ruleIds": ["BC-NN"] },
  "expectedRouter": { "required": ["route-id"], "allowedExtra": [] },
  "requiredSkills": ["om-skill-name"],
  "context": { "required": ["AGENTS.md", "owner/path"], "warn": ["node_modules/@open-mercato/*/src/**"], "forbidden": [".env*", ".git/**"] },
  "requiredDecisions": ["semantic-decision-id"],
  "forbiddenPatterns": ["unsafe-regex"],
  "validators": ["catalog.schema", "owner.reference", "skills.reference", "router.contract", "context.budget", "context.forbidden", "patterns.forbidden"],
  "maxContextFiles": 5,
  "maxInitialContextBytes": 24576,
  "maxTotalContextBytes": 98304,
  "relatedCases": ["OMH-NNN"]
}
```

Omit `decisionVocabulary` when every offered label is mandatory. Include it only
for a contrastive case; it must contain every `requiredDecisions` label plus at
least one plausible but unmandated distractor, for example
`"decisionVocabulary": ["semantic-decision-id", "contrastive-distractor-id"]`.

For `implementation` or `regression`, also declare `fixture`, `oracle`, and a narrow `allowedWrites`; add the ID to the writable registry/release matrix only when an executable disposable fixture exists. A regression oracle must fail before the edit and pass after it. When the task needs exact installed-package contracts, add one to three `frameworkContext` entries, each with exactly one `module` or `package` selector and one bounded `query`; the controller materializes and allowlists that evidence before the model runs. Queries must resolve to distinct package/version output roots.

Update together:

- `cases.json`, its expected count/ID sequence, and `cases.schema.json` enums;
- `validators.json` catalog counts/sets and semantic validator definitions;
- `release-matrix.json` only when the case belongs to a release lane;
- `fixtures/index.json` for writable setup;
- the feature spec's numbered use-case list and coverage totals.

Run in order:

```text
yarn harness:validate --case OMH-NNN
yarn harness:validate --runner codex --case OMH-NNN
yarn harness:validate --family <family>
yarn harness:validate --all
```

The last command is the deterministic catalog gate only. It does not execute the release matrix's live, writable, target-build, or generated-code-review lanes.

For a writable case, prepare one fresh disposable app per run before invoking the live oracle:

```text
yarn harness:fixture --case OMH-NNN --target /absolute/disposable/app --acknowledge-writes
yarn harness:validate --runner codex --case OMH-NNN --writable-root /absolute/disposable/app --acknowledge-writes
```

After the writable oracle passes, validate the generated target itself:

```text
cd /absolute/disposable/app
yarn generate
yarn typecheck
yarn lint
yarn build
```

When the generated result adds or changes tests, also run the smallest focused command that executes those exact unit or integration tests (`yarn test ...`, `yarn test:integration ...`, or the repository's narrower existing script). Record the command and result; typecheck/build are not test execution.

Review is mandatory before release. Run `om-code-review` on the harness diff. For every eligible one-shot implementation result, run the isolated generated-code review from the controller app using the passing writable result and unchanged disposable target:

```text
yarn harness:validate --runner codex --review-writable-result /absolute/controller/.ai/harness/results/<writable-result>.json --writable-root /absolute/disposable/app
```

Resolve blocking findings, then use a fresh controller scaffold and a new or empty target directory for the complete per-release suite:

```text
yarn install-skills
yarn harness:release --runner codex --prepare-targets /absolute/empty-release-targets --acknowledge-writes
```

Require the schema-valid sanitized `*-release-suite.json` report under `.ai/harness/results/` and every requested lane to pass. The explicit primary runner owns all blocking routing, writable, test, and review work. A different `--portability-runner` is optional; when omitted the report must say `portabilityRunner: null`, and when requested its 46-case read-only portability lane is blocking. macOS needs `/usr/bin/sandbox-exec`; Linux needs Bubblewrap with user namespaces. Unavailable containment or required model capacity is a blocker, not a pass.

If live capacity is unavailable, record the tool/version/model and sanitized provider error. Do not convert availability failure into a passing routing result.
