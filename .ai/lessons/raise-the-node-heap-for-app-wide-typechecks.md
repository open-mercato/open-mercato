---
title: "Raise the Node heap for app-wide typechecks"
modules: ["platform"]
areas: ["testing","debugging"]
topics: ["node-runtime","build-output","testing"]
---

# Raise the Node heap for app-wide typechecks

**Context**: Running the app-wide `tsc --noEmit` exhausted Node 24's default 4 GB heap. The process died with exit code 129, which turbo surfaced as a generic task failure with no type errors listed.

**Problem**: An out-of-memory kill is indistinguishable from a real typecheck failure when the runner only reports a non-zero exit code. Agents then hunt for type errors that were never emitted.

**Rule**: Run app-wide typechecks with `NODE_OPTIONS=--max-old-space-size=8192`. Treat a typecheck that fails with no diagnostic output as an OOM until the raised-heap run proves otherwise.

**Applies to**: `yarn typecheck` on the app workspace, CI typecheck steps, and any large-project `tsc --noEmit` invocation.
