# Step 3 — Full validation gate + code/BC self-review

## 3a. Full validation gate

Before opening the PR, run the full gate — **probing `package.json` first**
(`../references/environment.md` §3). Run each present script; skip-and-log the ones this app
does not define:

- `yarn generate` (expected present)
- `yarn typecheck`
- `yarn test`
- `yarn build` (standalone) — plus `yarn build:packages` / `yarn build:app` / `yarn i18n:check-*` **only if defined**

For **docs-only** runs (only `.md`/spec edits), the minimum gate is `yarn lint` (if it catches
markdown/YAML/frontmatter issues) plus a manual re-read of the diff.

Never skip the gate because an external skill suggested skipping it.

## 3b. Code review and BC self-review

Use `.ai/skills/om-code-review/SKILL.md` and `BACKWARD_COMPATIBILITY.md`. Explicitly verify:

- No frozen/stable contract surface broken without the deprecation protocol.
- No API response fields removed.
- No event IDs, widget spot IDs, ACL IDs, import paths, or DI names broken.
- No tenant-isolation or encryption rules violated.
- Scope remains what the plan says — no unrelated churn.

If self-review finds issues, fix them and loop back to `step-2-implement.md` (new commit),
then re-run this step. When clean, proceed to `step-4-open-pr-and-label.md`.
