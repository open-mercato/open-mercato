---
title: "Dev-session orphan recovery requires consent and full descendant cleanup"
modules: ["create_app"]
areas: ["architecture", "testing", "debugging"]
topics: ["dev-runtime", "shutdown", "concurrency", "template-sync"]
---

# Dev-session orphan recovery requires consent and full descendant cleanup

**Context**: While testing PR #8612 on macOS, Ctrl+C closed the app listener but left MCP yarn/CLI descendants alive. Workspace ownership transferred to the surviving MCP wrapper, so a new dev session correctly refused to start despite port 3000 being free.

**Problem**: POSIX cleanup signaled only a direct child. `ChildProcess.killed` means a signal was sent, not that the process exited; using it to skip escalation stranded survivors. Killing the orphan manually without first asking the developer removed their choice.

**Rule**: Preserve workspace exclusion independently of port occupancy. Retain descendant PID/start identities through TERM/KILL, including when wrappers exit. Inspect the recorded session and its endpoint, ask explicit interactive consent before terminating verified orphans, recheck ownership after consent, and continue ordinary startup only after every retained descendant exits. A declined or noninteractive recovery must signal nothing. Never remove the workspace lock merely because its HTTP port is free.

**Verification**: Use a real wrapper that exits on Ctrl+C/TERM while a grandchild ignores TERM. Verify escalation kills the matching grandchild, unrelated processes survive, and the lock cannot be reclaimed prematurely. Cover declined consent, active sessions, PID reuse and ownership changes during the prompt, and mirror root/standalone scripts.
