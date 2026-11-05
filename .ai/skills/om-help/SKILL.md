> **Repo-local override.** Adds Open Mercato's topic → `AGENTS.md` knowledge map and opt-in tier install hints to the base skill, whose workflow sequences come from `help.data` in `.ai/agentic.config.json`.

## Step 4 — routing data (add)

Knowledge questions: after the root `AGENTS.md` Task Router, read `references/knowledge-map.md` (this folder) to find the package `AGENTS.md` to ground the answer in. The Task Router stays authoritative; a disagreement is reported as drift.

## Step 4 — drift checks (add)

A skill the routing data names that sits in an opt-in tier of `.ai/skills/tiers.json` (for example `om-wcag-guardian` in `analysis`, `om-integration-builder` in `infra`) is reported as not installed with its install command, `yarn install-skills --with <tier>`, instead of being recommended as runnable.
