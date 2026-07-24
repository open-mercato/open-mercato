# Reproducible Case Template

Use the next contiguous `OMH-NNN` ID. Copy an adjacent case from `.ai/harness/cases.json`, then fill this contract rather than inventing a second format:

```json
{
  "id": "OMH-NNN",
  "title": "Concrete user outcome",
  "family": "architecture|module|umes|integration|ai-workflow|bugfix|business",
  "mode": "analysis|one-shot|spec|bugfix|review",
  "evaluationKind": "static|routing|implementation|regression",
  "risk": "low|medium|high",
  "prompt": "Standalone user request with observable scope",
  "tags": ["kebab-case"],
  "owner": { "kind": "root|guide|skill|facts|hook", "path": "app/relative/path", "ruleIds": ["BC-NN"] },
  "expectedRouter": { "required": ["route-id"], "allowedExtra": [] },
  "requiredSkills": ["om-skill-name"],
  "context": { "required": ["AGENTS.md", "owner/path"], "forbidden": [".env*", ".git/**", "node_modules/**"] },
  "requiredDecisions": ["semantic-decision-id"],
  "forbiddenPatterns": ["unsafe-regex"],
  "validators": ["catalog.schema", "owner.reference", "skills.reference", "router.contract", "context.budget", "context.forbidden", "patterns.forbidden"],
  "maxContextFiles": 5,
  "maxInitialContextBytes": 24576,
  "maxTotalContextBytes": 98304,
  "relatedCases": ["OMH-NNN"]
}
```

For `implementation` or `regression`, also declare `fixture`, `oracle`, and a narrow `allowedWrites`; add the ID to the writable registry/release matrix only when an executable disposable fixture exists. A regression oracle must fail before the edit and pass after it.

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

If live capacity is unavailable, record the tool/version/model and sanitized provider error. Do not convert availability failure into a passing routing result.
