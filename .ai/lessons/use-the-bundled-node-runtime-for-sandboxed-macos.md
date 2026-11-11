---
title: "Use the bundled Node runtime for sandboxed macOS verification"
modules: ["platform","create_app"]
areas: ["testing","debugging"]
topics: ["testing","node-runtime","engine-version","sandbox","temporary-directories"]
---

# Use the bundled Node runtime for sandboxed macOS verification

**Context**: The standalone agent-harness tests launch nested processes inside a macOS sandbox. A Homebrew Node binary can depend on dynamic libraries under `/opt/homebrew`, which the nested sandbox does not allow the process to load. Node 26.12.1 and Node 24.22.2 also failed inside the harness while searching for a parent `package.json` outside its sandbox allowlist, reported as `operation not permitted`. The repository declares Node 24; the same targeted writable-context harness case passed with the installed self-contained Node 24.19.0. A fresh checkout can also lack the docs search index required by the full gate.

**Rule**: Check `package.json` engines before the first validation command, and use a matching runtime for the parent and subprocesses. Confirm failures on the declared runtime before changing application code; a different runtime can hide a fixture defect. Probe a failing sandbox case with a known working matching runtime before repeating the full gate. When harness tests fail broadly with `dyld` or blocked Node-library errors, put the workspace's self-contained Node runtime first on `PATH` and rerun the same complete gate command. A full `yarn test` run can reach nested create-app suites before exposing the blocked Homebrew dependency, so a targeted package rerun is not equivalent evidence. Do not diagnose the resulting cascade as product failures until the runtime can start inside the sandbox. If the bundled-runtime rerun ends with a one-off Jest worker `SIGSEGV` after its assertions pass, rerun that test file in-band before retrying the full gate; do not change unrelated product code unless the failure reproduces. Build the docs search index first when a fresh checkout does not contain it.

**Fixture isolation**: Extensionless fake Node executables also need an explicit local CommonJS manifest or a `.cjs` filename. Node 24.22.2 can otherwise read a denied ancestor manifest before the fixture starts; #8625 fixes that precheck without adding sandbox grants. Set `TMPDIR`, `TMP`, and `TEMP` to the same dedicated directory outside the checkout during test validation. An inherited fallback inside the repository lets temporary standalone fixtures discover the real workspace and produces misleading CLI resolver failures. In the observed run, the three affected CLI files passed all 33 tests in isolation, and setting all three variables consistently restored all 2350 CLI tests in the full gate.

**Applies to**: `create-mercato-app` agent-harness tests and validation gates that execute them on macOS.
