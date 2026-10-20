> **Repo-local override.** Adds Open Mercato's spec locations and legacy report-PR titles to the shared `om-auto-sec-report` window resolution, and records the repo's publishing settings; per-unit specifics come from `.ai/skills/om-auto-sec-report-pr/SKILL.md`.

## Step 1 — window resolution (add)

- Spec windows accept any `.md` under `.ai/specs/`, including `.ai/specs/enterprise/`.
- Earlier report PRs in this repo used the title prefix `docs(analysis): add auto-sec-report` (driver) and `docs(analysis): add auto-sec-report-pr` (single unit). Exclude them from the queue exactly like PRs titled `docs(analysis): add security report`.

## Step 7 — deliver: publish settings (add)

This repo sets `securityReport.publish: "pr"` and `securityReport.disclosure: "withhold-live"` in `.ai/agentic.config.json`: the aggregate markdown and its HTML mirror ship as one docs-only PR against `develop` (`baseBranch`, also the default `--base`), copied into `.ai/analysis/`; withheld findings appear only as placeholders and counts, disclosed privately through `SECURITY.md`. Never merge.
