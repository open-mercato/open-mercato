---
name: om-setup-ci
description: Set up or refresh CI for a standalone Open Mercato app in one command — GitHub Actions with dependency audit, secret scan (Gitleaks), SAST (Semgrep with Open Mercato rules), workflow security (zizmor), lint, generate + clean-tree check, typecheck, design-system check, unit tests, build, ephemeral integration tests, Docker build with Trivy, nightly audit and security scans, optional CodeQL and OWASP ZAP, Dependabot, SHA-pinned actions, and client-facing docs. Use for "set up CI", "add GitHub Actions", "add security scanning", "SAST/DAST", "refresh CI", "skonfiguruj CI".
---

# Set Up CI

One deterministic generator, `scripts/setup-ci.mjs`, does the work. Your job is to choose its options, run it, and explain the result. Do not hand-write workflow files.

## Workflow

1. Confirm the provider. Only `github` is supported. For any other provider, stop and say so; do not improvise a pipeline.
2. Preview the plan: `node .ai/skills/om-setup-ci/scripts/setup-ci.mjs --dry-run`. It reports the detected branches, Node source, and each check as enabled or disabled with the reason.
3. Ask the user only about what detection cannot know:
   - which branches to protect, when the detected list looks wrong;
   - whether the repository is private and the build may need a larger runner (`--runner`);
   - whether the repository is public or has GitHub Code Security: only then offer `--with-code-scanning` (CodeQL plus SARIF uploads);
   - whether they want the nightly OWASP ZAP scan (`--with-dast`);
   - whether to disable any check they explicitly do not want (`--no-<check>`).
4. Run the generator with the agreed flags and no `--dry-run`. Exit code `3` means some files already exist with different content and nothing was written. Show the user the differences, then re-run with `--force` only after they agree. `scripts/ci/audit-ci-allowlist.json` and `scripts/ci/zap-rules.tsv` are never overwritten.
5. Run the fast checks locally to verify them: `node scripts/ci/audit-ci.mjs --severity high` and, when Docker is available, the Semgrep and Gitleaks commands from `docs/ci/README.md` → *Running the checks locally*. Report existing findings; do not suppress them yourself.
6. Commit on a branch and open a pull request so the first run executes, following `.ai/agentic.config.json` (`om-open-pr` when installed).
7. Tell the user to mark the `CI` check as required and to enable secret scanning push protection (`docs/ci/README.md` → *Branch protection and repository settings*). Do not change repository settings yourself unless they ask; these are admin changes to shared settings.

## Options

`--branches a,b` · `--node <v>` · `--runner <label>` · `--audit-severity low|moderate|high|critical` · `--audit-cron "<cron>"` · `--target <dir>` · `--dry-run` · `--force` · `--json`.

Checks, on by default (`--no-<check>` turns one off): `secrets`, `sast`, `workflow-lint`, `lint`, `typecheck`, `ds-check`, `time-bombs`, `test`, `build`, `integration`, `docker`, `image-scan`, `scheduled-audit`, `scheduled-security`, `dependabot`. Off by default (`--with-<check>` turns one on): `code-scanning`, `dast`.

Options are saved in `.github/om-ci.json`, so a later `--force` refresh keeps them.

## Rules

- Never weaken a gate to get a green first run: do not add `continue-on-error`, delete steps, or add suppressions (`nosemgrep`, `.gitleaksignore`, `.trivyignore`, allowlist entries, ZAP `IGNORE`). Report the finding and fix its cause; suppress only a confirmed false positive, with the reason written next to it, and only when the user agrees.
- If the secret scan finds a credential, tell the user to revoke and rotate it at the provider first. Deleting the commit does not undo the leak.
- Never put secrets in workflow files; use `${{ secrets.NAME }}`.
- Keep deploy steps out of `ci.yml`; put them in a separate workflow triggered after `CI`.
- If the user edits generated files, warn them that `--force` overwrites those edits.
- `templates/docs/README.md` explains each check, why it exists, and what it does not cover. Read it before answering questions about the pipeline.
- Changing a pinned action, image or tool version: edit `ACTIONS` / `TOOLS` in `scripts/setup-ci.mjs`, choose a release at least two weeks old, pin the commit SHA, image digest or checksum, then regenerate.
- Changing an Open Mercato Semgrep rule: update `templates/scripts/ci/semgrep/open-mercato.yml` and its annotated fixture `open-mercato.fixture.txt` (`// ruleid:` must match, `// ok:` must not), then run `node .ai/skills/om-setup-ci/scripts/verify-semgrep-rules.mjs` (needs Docker).
