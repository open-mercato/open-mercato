---
title: "Dev session shutdown must verify process exit"
modules: ["cli","create_app"]
areas: ["architecture","debugging","testing"]
topics: ["dev-runtime","process-lifecycle","concurrency"]
---

# Dev session shutdown must verify process exit

**Context**: After Ctrl+C, greenfield startup reported a dead owner PID while a managed child still held the session. The app port could be free even though initialization descendants remained alive.

**Rule**: `ChildProcess.killed` means a signal was sent, not that the process exited. Keep the original shutdown targets through the force-kill phase, include managed descendants and exact-session orphans, verify process start identity before signaling recorded PIDs, and wait for exit before releasing ownership. On POSIX, signaling a wrapper alone does not terminate its grandchildren.

**Ownership corollary**: A free TCP port does not prove the workspace is idle during builds or initialization. Recover dead or reused PID records, report the actual live blocker, and check the actual local bind port before mutable startup work. Managed children joining an existing session must not reject their parent's listener.

**Verification**: Exercise TERM-ignoring grandchildren, wrappers that exit before cleanup, stale PID reuse, real occupied/free listeners, and a live initializer before its port opens. Mirror launcher helpers into the standalone template and register new files in template sync.
