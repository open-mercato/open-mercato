---
name: check-and-commit
description: Verify that the Open Mercato app is ready to publish by running build, generation, i18n, typecheck, unit test, and app build checks; fix obvious i18n sync or usage issues; and if everything passes, commit and push the current branch. Use this skill when the user asks to check the branch, make CI-style verification pass, fix i18n drift, then commit and push.
---

# Check And Commit

Use this skill when the user wants a branch verified end to end and published only if the repository is in a good state.

## Workflow

1. Scope the change first.
2. Run the verification gates in repo order.
3. Fix straightforward failures, especially i18n drift and missing locale keys.
4. Re-run the failed gates until green.
5. Commit and push only after all required checks pass.

## Scope

- Read `git status --short` and `git diff --stat` first.
- If the diff touches a specific package or module, read the relevant `AGENTS.md` before making fixes.
- Do not revert unrelated user changes.

## Verification Gates

Run these commands in this order unless the user asks for a narrower scope:

```bash
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
```

Then run these two in parallel:

```bash
yarn typecheck
yarn test
```

Finish with:

```bash
yarn build:app
```

## I18n Repair Rules

- Treat `yarn i18n:check-sync` as a required gate.
- Keep locale files aligned across `en`, `de`, `es`, and `pl`.
- Do not leave hard-coded user-facing strings in changed code.
- If `yarn i18n:check-usage` reports missing keys, add them.
- If it reports unused keys introduced by the current work, remove them.
- If usage failures appear unrelated and fixing them would expand scope materially, report the blocker and stop before commit.

## Fixing Failures

- Prefer minimal fixes that make the branch correct and mergeable.
- Re-run only the failed command after each fix, then run the full tail of dependent checks again when needed.
- If `yarn generate` changes files, include those generated files in the verification flow and rebuild afterward.
- If a migration is needed, generate it properly and confirm snapshots match current entities before continuing.
- Do not claim success while any required gate is still failing.

## Commit And Push

Only commit and push when the user explicitly asked for publication in the same request.

Before committing:

- Confirm `git status --short` contains only intended changes.
- Review the final diff for accidental noise.
- Use a non-interactive git commit.
- Do not amend existing commits unless the user asked for it.

Push the current branch after the commit succeeds.

## Output

Report:

- which gates passed
- which issues were fixed
- whether i18n was updated
- the commit SHA and branch name if a push happened

If any required gate still fails, stop and report the exact blocker instead of committing.
