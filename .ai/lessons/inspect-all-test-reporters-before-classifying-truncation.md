---
title: "Inspect all test reporters before classifying a truncated run"
modules: ["create_app"]
areas: ["testing","debugging"]
topics: ["validation-evidence","test-reporters","timeouts","test-prerequisites"]
---

# Inspect all test reporters before classifying a truncated run

**Context**: The Hono remediation gate reached 50 successful Turbo tasks and 42 passing Jest package summaries before the scaffold package timed out. Its Node test reporter had already printed a failed ZIP preparer test.

**Problem**: Scanning only Jest `FAIL` and summary lines missed Node's `✖` failure marker. The resulting timeout-only report omitted an assertion failure whose diagnostic was deferred until the run-level summary.

**Rule**: Inspect every reporter's failure markers and summaries before classifying a truncated run. Preserve observed assertion failures separately from unfinished checks, and reproduce each named failure narrowly to obtain its full diagnostic. Verify documented test prerequisites before a broad retry. Do not claim baseline equivalence from unchanged source or from a timeout alone.

**Evidence**: Independent review of PR #9471 caught the omitted ZIP failure. The focused test diagnosed missing Info-ZIP `unzip` (ENOENT); it passed after a checksum-verified validation tool was provided in owned temporary storage, without weakening the test or changing application dependencies.
