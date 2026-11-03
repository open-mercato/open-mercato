---
title: "Archive rotated context as one batch"
modules: ["platform"]
areas: ["ai-workflow","testing"]
topics: ["context-budget","archival","file-count","regression-testing"]
---

# Archive rotated context as one batch

The first version of PR #8652 replaced 300 historical run artifacts with 300 individual archives. It reduced bytes but kept hundreds of archive entries in `.ai/runs`, missing the requested file-count reduction.

A rotation must collect every eligible artifact into one archive for that invocation. Preserve each original top-level path inside it, verify the complete member inventory and file bytes before removing any source, and retain active or uncertain context. Regression coverage must use multiple flat plans and nested run folders and assert exactly one new archive, complete restoration, and fewer files in the runs directory. Archive bytes alone do not prove successful context cleanup.
