---
title: "Queue triage stops do not complete a fix quota"
modules: ["platform"]
areas: ["ai-workflow"]
topics: ["autofix", "triage", "completion", "approval"]
---

# Queue triage stops do not complete a fix quota

When a task asks for a number of fixes from an eligible queue, a missing implementation, existing fix PR, or unconfirmed defect only disqualifies that candidate. Continue selecting eligible replacements until the requested fixes are delivered or the eligible queue is exhausted. Respect active claims and keep the stop evidence; do not count a clean triage stop as a delivered fix. Check that candidate source exists on the assigned branch before spending a bounded worker slot.

For a single-PR repair, an optional architecture alternative must not be reported as completed conflict resolution or as waiting on another actor. Complete independent authorized fixes, name the exact decision that remains, and state plainly which conflicts are still unresolved. Once the author approves the choice, resume the prepared work without requesting approval again.
