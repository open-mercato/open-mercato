> **Repo-local override.** Adds Open Mercato's workflow sequences and topic → `AGENTS.md` knowledge map to the base skill's routing sources.

## Step 4 — routing data (add)

- Navigation: read `references/workflow-sequences.md` (this folder) as this repository's `help.data`, ahead of the default `.ai/help/*.md` glob, which matches nothing here.
- Knowledge: after the root `AGENTS.md` Task Router, read `references/knowledge-map.md` (this folder) to find the package `AGENTS.md` to ground the answer in. The Task Router stays authoritative; a disagreement is reported as drift.

## Step 4 — drift checks (add)

A skill the routing data names that sits in an opt-in tier of `.ai/skills/tiers.json` (for example `om-auto-sec-report*` in `security`, `om-integration-builder` in `infra`) is reported as not installed with its install command, `yarn install-skills --with <tier>`, instead of being recommended as runnable.
