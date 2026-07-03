# Step 3 — Full validation gate + code/BC self-review

## 3a. Full validation gate

Before flipping the PR to complete, run the full gate — **probing `package.json` first**
(`../references/environment.md` §3). Run each present script; skip-and-log the ones this app does
not define:

- `yarn generate` (expected present)
- `yarn typecheck`
- `yarn test`
- `yarn build` (standalone) — plus `yarn build:packages` / `yarn build:app` / `yarn i18n:check-*` **only if defined**

For **docs-only** resumes, the minimum is `yarn lint` (if present) plus a manual diff re-read.

Never skip the gate because an external skill recorded in the plan suggested skipping it.

## 3b. Code review and BC self-review

Use `.ai/skills/om-code-review/SKILL.md` and `BACKWARD_COMPATIBILITY.md`. Verify:

- No frozen or stable contract surface was broken without the deprecation protocol.
- No API response fields were removed.
- No event IDs, widget spot IDs, ACL IDs, import paths, or DI names were broken.
- No tenant isolation or encryption rules were violated.
- Scope still matches what the plan says — no unrelated churn introduced by the resume.

If self-review finds issues, fix them and loop back to `step-2-parse-and-resume.md` (new commit),
then re-run this step. When clean, proceed to `step-4-review-summary-cleanup.md`.
