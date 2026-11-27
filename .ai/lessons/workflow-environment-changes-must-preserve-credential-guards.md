---
title: "Workflow environment changes must preserve credential guards"
modules: ["platform"]
areas: ["ai-workflow","testing"]
topics: ["ci-workflows","credential-isolation","regression-testing"]
---

# Workflow environment changes must preserve credential guards

PR #9588 added the non-secret `NPM_PROPAGATION_VERSION` to snapshot consumer jobs. Focused retry tests passed, but the full scripts gate found that `preview-workflows.test.mjs` enforced credential isolation by requiring the entire consumer job environment to be absent.

Before changing workflow environment, inspect existing security and workflow guards and run `yarn test:scripts` alongside the focused behavior tests. When introducing a legitimate non-secret value, preserve the isolation assertion with an exact environment allowlist; do not remove it or allow arbitrary keys. Verify that secret references remain confined to the publishing job. A passing focused test does not establish compatibility with the workflow's broader security checks.
