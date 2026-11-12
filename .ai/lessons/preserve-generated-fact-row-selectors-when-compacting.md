---
title: "Preserve generated fact row selectors when compacting"
modules: ["cli","create_app"]
areas: ["testing","debugging"]
topics: ["generated-files","context-budgets","backward-compatibility"]
---

# Preserve generated fact row selectors when compacting

PR #7619 exceeded the generated Markdown size guard. Removing all event-cell padding restored the byte budget but made the source-link regression select another table containing the same event ID.

Preserve the first cell marker used to distinguish fact rows and compact the remaining cells. Keep every rendered expression, source link, heading and strict budget assertion. Validate both the size guard and the existing source-link assertions; a smaller artifact alone is insufficient.
