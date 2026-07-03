# Step 3 — Validation gate, code-review, BC self-review

Do not stop after one edit. Keep iterating until the issue is fixed and the change is reviewable.

## 3a. Fix-validation loop (per iteration)

1. Run unit tests for every changed package or module.
2. Run typecheck for every changed package or module.
3. If i18n files or user-facing strings changed, run `i18n:check-sync` and `i18n:check-usage`.
4. If module structure, generated files, entities, or routes changed, run the required generators
   and follow-ups: `generate`, then `db:generate` when entity schema changed.
5. Re-read the diff and remove any accidental scope creep.
6. Grep changed non-test files for raw `em.findOne(` / `em.find(` — replace with
   `findOneWithDecryption` / `findWithDecryption`. This is a hard rule from AGENTS.md.

## 3b. Full verification gate (probe before running)

The standalone template ships a subset of the monorepo scripts. Probe each script and skip-and-log
when it is undefined (environment §3) — do not fail the run on a missing script:

```bash
run_if_present typecheck
run_if_present test
run_if_present generate
run_if_present build
# monorepo-only — become no-ops when absent in this app:
run_if_present i18n:check-sync
run_if_present i18n:check-usage
run_if_present build:packages
run_if_present build:app
```

Minimum gate that must pass in standalone mode (when the script is present): `typecheck`, `test`,
`generate`, `build`. If the full gate is too expensive to run while debugging, do targeted checks
first, but every present script in the gate must pass before you open or update the PR unless a real
blocker prevents it.

## 3c. Code-review and backward-compatibility self-review

Before publishing, run the change through the same review discipline as an incoming PR. Use
`.ai/skills/om-code-review/SKILL.md` and `BACKWARD_COMPATIBILITY.md`.

Explicitly verify:

- no frozen or stable contract surface was broken without the deprecation protocol
- no API response fields were removed
- no event IDs, widget spot IDs, ACL IDs, import paths, or DI names were broken
- no tenant isolation or encryption rules were violated — every raw `em.findOne(` / `em.find(` in
  production code uses `findOneWithDecryption` / `findWithDecryption` instead
- the fix remains minimal and does not introduce unrelated churn

If your self-review finds new issues, fix them and repeat the validation loop. Then proceed to
`step-4-open-pr-and-label.md`.
