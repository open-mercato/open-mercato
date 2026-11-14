---
title: "Query diagnostics must survive result replacement"
modules: ["query_index"]
areas: ["module-data","umes","testing"]
topics: ["query-index","encryption","filters"]
---

# Query diagnostics must survive result replacement

**Context**: PR #6827 attached development encrypted-search warnings in BasicQueryEngine. Hybrid fallback returns then ran their own after-query pipeline, whose supported replacement result could omit that metadata and erase the diagnostic.

**Rule**: Carry request diagnostics across result replacement and attach them after the outermost extension pipeline. Cover every fallback exit with the real fallback engine and a registered replacement subscriber; also verify subscriber pagination and unrelated metadata survive, production omits diagnostics, and scope IDs and search values never enter warning metadata.

**Applies to**: query-engine fallback returns, after-query subscribers, and development response diagnostics.
