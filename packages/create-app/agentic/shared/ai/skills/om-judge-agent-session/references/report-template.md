# Judge Report Template

Use these headings in this order:

```markdown
# Agent Session Judge Report

## Verdict
pass | fail | inconclusive — one-sentence rationale

## Evidence
- Input: kind, identifier, schema/bundle version, hashes
- Rules: project/framework version and review skills
- Termination: completed | provider-limit | provider-error | user-abort | unknown — sanitized last-entry error summary or “none”
- Fixed attestations: generate/typecheck/lint/build/tests/oracles/route uniqueness
- Privacy: pass/fail/unavailable

## Artifact Findings
1. [severity] category — file:line or evidence path
   - Rule:
   - Evidence:
   - Fix:
   - Confidence:

## Design-System Review
Reviewer/references used, findings, or not applicable.

## Harness-Owner Findings
1. Artifact finding reference
   - Smallest owner: root|guide|skill|facts|hook|case|oracle — path or ID
   - Escape reason:
   - Smallest harness fix:
   - Rerun:

## Missing or Unverifiable Evidence
- Exact missing/stale item and its effect on the verdict.

## Recommended Next Actions
1. Fix blocking artifact defects.
2. Improve the named harness owners.
3. Rerun the listed cases and fixed gates.
```

Omit empty numbered findings but retain every heading. Do not include raw transcripts, secrets, absolute home paths, or claims that unavailable validation passed.
