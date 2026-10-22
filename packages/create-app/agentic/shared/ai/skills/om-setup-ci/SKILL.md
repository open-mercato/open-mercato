---
name: om-setup-ci
description: Set up or refresh CI for a standalone Open Mercato app in one command — GitHub Actions workflows with dependency audit, lint, generate + clean-tree check, typecheck, design-system check, time-bomb test scan, unit tests, production build, ephemeral integration tests, Docker build, nightly audit, Dependabot, and client-facing docs. Use for "set up CI", "add GitHub Actions", "configure pipeline", "refresh CI", "skonfiguruj CI".
---

# Set Up CI

One deterministic generator, `scripts/setup-ci.mjs`, does the work. Your job is to choose its options, run it, and explain the result. Do not hand-write workflow files.

## Workflow

1. Confirm the provider. Only `github` is supported. For any other provider, stop and say so; do not improvise a pipeline.
2. Preview the plan: `node .ai/skills/om-setup-ci/scripts/setup-ci.mjs --dry-run`. It reports the detected branches, Node source, and each check as enabled or disabled with the reason.
3. Ask the user only about what detection cannot know:
   - which branches to protect, when the detected list looks wrong;
   - whether the repository is private and the build may need a larger runner (`--runner`);
   - whether to disable any check they explicitly do not want (`--no-<check>`).
4. Run the generator with the agreed flags and no `--dry-run`. Exit code `3` means some files already exist with different content and nothing was written. Show the user the differences, then re-run with `--force` only after they agree. `scripts/ci/audit-ci-allowlist.json` is never overwritten.
5. Run the audit locally to verify it: `node scripts/ci/audit-ci.mjs --severity high`. If it fails on existing advisories, report them; do not allowlist them yourself.
6. Commit on a branch and open a pull request so the first run executes, following `.ai/agentic.config.json` (`om-open-pr` when installed).
7. Tell the user to mark the `CI` check as required (`docs/ci/README.md` → Branch protection). Do not change branch protection yourself unless they ask; it is an admin change to a shared setting.

## Options

`--branches a,b` · `--node <v>` · `--runner <label>` · `--audit-severity low|moderate|high|critical` · `--audit-cron "<cron>"` · `--no-<check>` / `--with-<check>` for `lint`, `typecheck`, `ds-check`, `time-bombs`, `test`, `build`, `integration`, `docker`, `scheduled-audit`, `dependabot` · `--target <dir>` · `--dry-run` · `--force` · `--json`.

Options are saved in `.github/om-ci.json`, so a later `--force` refresh keeps them.

## Rules

- Never weaken a gate to get a green first run: do not add `continue-on-error`, delete steps, or allowlist advisories. Report the failure and fix its cause.
- Never put secrets in workflow files; use `${{ secrets.NAME }}`.
- Keep deploy steps out of `ci.yml`; put them in a separate workflow triggered after `CI`.
- If the user edits generated files, warn them that `--force` overwrites those edits.
- `templates/docs/README.md` explains each check and why it exists. Read it before answering questions about the pipeline.
