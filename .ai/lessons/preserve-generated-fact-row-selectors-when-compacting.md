---
title: "Preserve generated fact row selectors when compacting"
modules: ["cli","create_app"]
areas: ["testing","debugging"]
topics: ["generated-files","context-budgets","backward-compatibility","markdown","code-review"]
---

# Preserve generated fact row selectors when compacting

PR #7619 exceeded the generated Markdown size guard. Removing all event-cell padding restored the byte budget but made the source-link regression select another table containing the same event ID.

Preserve the first cell marker used to distinguish fact rows and compact the remaining cells. Keep every rendered expression, source link, heading and strict budget assertion. Validate both the size guard and the existing source-link assertions; a smaller artifact alone is insufficient.

Measure both flat and directory totals: the first failed assertion can hide an over-budget directory render. Compare ordered data cells and exact source hrefs across the complete module set after compaction. Repeated table headers may decrease when smaller rows fit an existing anchored chunk; retain the row data and validate the regenerated anchors.

Preserve the complete row prefix selected by a consumer, including later cells when a check uses them. Find every direct renderer consumer rather than selecting tests only by the renderer filename; activation/topology tests can live outside the module-facts test family.
