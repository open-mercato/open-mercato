---
title: "Scope portaled row actions by record identity"
modules: ["workflows", "ui"]
areas: ["integration", "testing", "backend-ui"]
topics: ["ui-components", "testing"]
---

# Scope portaled row actions by record identity

**Context:** PR #7609's integration shard 14 exposed two simultaneously open row-action menus. TC-WF-006 found two Delete entries; TC-WF-007 selected the first global Edit entry and opened Refund Triage instead of its newly created four-step workflow. The screenshot and saved definition identity established a selection error, not a graph-rendering defect.

**Rule:** Capture a newly created record's canonical edit URL, open its row actions with the keyboard, and identify the portaled action or menu by that record-specific edit link. Assert the exact reopened URL before checking content. Row containment alone cannot scope a menu portaled into document.body; global .first() selection can silently act on another record. Preserve domain assertions when correcting the interaction target.

**Evidence:** [Failed CI shard](https://github.com/open-mercato/open-mercato/actions/runs/39130068357/job/117684255279), TC-WF-006 and TC-WF-007.
