> **Repo-local override.** Adds Open Mercato's spec locations and legacy report-PR titles to the shared `om-auto-sec-report` window resolution; per-unit specifics come from `.ai/skills/om-auto-sec-report-pr/SKILL.md`.

## Step 1 — window resolution (add)

- Spec windows accept any `.md` under `.ai/specs/`, including `.ai/specs/enterprise/`.
- Earlier report PRs in this repo used the title prefix `docs(analysis): add auto-sec-report` (driver) and `docs(analysis): add auto-sec-report-pr` (single unit). Exclude them from the queue exactly like PRs titled `docs(analysis): add security report`.
