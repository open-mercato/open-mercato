---
name: om-repair-resource-type-references
description: Preview and repair historical resource type references to missing, deleted, or out-of-scope types in one Open Mercato tenant and organization.
---

# Repair historical resource type references

Use this maintenance skill for existing resource records affected by issue #8498.

1. Confirm the checkout and target environment with the operator. Obtain the exact tenant and organization UUIDs. Use a checkout with installed dependencies, built packages, and generated app registries.
2. From the repository root, run the preview against the approved environment:
   ```sh
   yarn tsx .ai/skills/om-repair-resource-type-references/scripts/repair-resource-type-references.mts --tenant <tenant-uuid> --org <organization-uuid>
   ```
3. Report the aggregate `found` count and ask the operator to approve clearing the references in that exact environment and scope. Stop if the count is zero. The preview is a point-in-time check. Apply evaluates the same rule again against the current rows.
4. After approval, repeat the command with `--apply --journal /secure/path/resource-repair.json`. Choose a new journal path on durable local storage in a private directory. Run one repair at a time for the selected database and scope. Apply clears invalid references from live resources, advances their versions, and refreshes resource projections and list caches. Report the aggregate `cleared` count and verify with another preview.
5. If apply is interrupted, repeat the exact apply command with the same journal path, database configuration, and scope. A committed repair replays pending update effects and reports the aggregate `replayed` count. Effects can be delivered more than once if the previous run stopped during publication. Inspect a rolled-back or indeterminate transaction before starting another apply. Keep the journal private because it contains record IDs. Once the follow-up preview is clean, handle the completed journal under the environment's retention policy.
