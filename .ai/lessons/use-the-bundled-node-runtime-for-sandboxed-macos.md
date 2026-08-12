---
title: "Use the bundled Node runtime for sandboxed macOS verification"
modules: ["platform","create_app"]
areas: ["testing","debugging"]
topics: ["testing","node-runtime"]
---

# Use the bundled Node runtime for sandboxed macOS verification

**Context**: The standalone agent-harness tests launch nested processes inside a macOS sandbox. A Homebrew Node binary can depend on dynamic libraries under `/opt/homebrew`, which the nested sandbox does not allow the process to load. A fresh checkout can also lack the docs search index required by the full gate.

**Rule**: When harness tests fail broadly with `dyld` or blocked Node-library errors, put the workspace's self-contained Node runtime first on `PATH` and rerun the same complete gate command. A full `yarn test` run can reach nested create-app suites before exposing the blocked Homebrew dependency, so a targeted package rerun is not equivalent evidence. Do not diagnose the resulting cascade as product failures until the runtime can start inside the sandbox. Build the docs search index first when a fresh checkout does not contain it.

**Applies to**: `create-mercato-app` agent-harness tests and validation gates that execute them on macOS.
