---
title: "Queue triage stops do not complete a fix quota"
modules: ["platform"]
areas: ["ai-workflow"]
topics: ["autofix", "triage", "completion"]
---

# Queue triage stops do not complete a fix quota

When a task asks for a number of fixes from an eligible queue, a missing implementation, existing fix PR, or unconfirmed defect only disqualifies that candidate. Continue selecting eligible replacements until the requested fixes are delivered or the eligible queue is exhausted. Respect active claims and keep the stop evidence; do not count a clean triage stop as a delivered fix. Check that candidate source exists on the assigned branch before spending a bounded worker slot.
