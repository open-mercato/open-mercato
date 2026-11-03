---
name: om-auto-qa-pr
description: Open Mercato repo-local extension of the shared `om-auto-qa-pr` skill (installed from open-mercato/skills into .agents/skills/). Adds this product's locales, risk checklist and environment facts. Applied automatically by the shared skill.
---

# Auto QA PR — Open Mercato extension

This file extends the shared `om-auto-qa-pr` skill from [open-mercato/skills](https://github.com/open-mercato/skills). It only adds product facts; every shared rule, gate and safety rule still applies.

## In every run

- Read [`.ai/docs/qa-risk-checklist.md`](../../docs/qa-risk-checklist.md) before writing the scenario, and use the sections for the modules the PR touches. Its "False alarms" section lists environment effects that are not bugs.
- Check a 500 on a production build before reporting it, because dev mode adds its own failures.

## With `--complex`

`om-auto-merge-buddy` passes `--complex` to every PR carrying `needs-qa` (`automerge.complexQa` in `.ai/agentic.config.json`). Use these facts for its rules:

- **Languages:** the supported locales are `en`, `pl`, `es`, `de` and `ko`. The default local UI is Polish, so PR text quoting English names will not match the screen. Check new texts in every locale file of the touched module and in `apps/mercato/src/i18n`.
- **Decimal comma:** use the Polish locale for amount fields.
- **Test data:** seeded `employee` has sales manage features, so it is not a no-permission role for sales. Build a narrow role. `superadmin@acme.com` is tenant-scoped, not global.
- **Prices:** some seeded prices have net equal to gross at 23% tax. Create a price with correct net and gross before judging a total.
- **Toggles:** some features sit behind a tenant feature toggle that is off by default. Check the PR and the module for one, and switch it on in the UI.

## Feeding the checklist

When a human finds a bug this skill missed, add one line to the matching section of the checklist in the same PR as the fix, or in a QA follow-up.
