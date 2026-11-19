---
title: "Replay covers SDK preprocessing and trial state"
modules: ["agent_orchestrator", "ai_assistant"]
areas: ["ai-workflow", "testing"]
topics: ["offline-replay", "fixtures", "sdk-preprocessing", "file-io"]
---

# Replay covers SDK preprocessing and trial state

A-3's first review found text-only round trips missed three failures: the SDK downloaded unsupported URL attachments during recording but passed URLs during replay; a FIFO blocked synchronous open before file validation; and a default programmatic fixture store overwrote earlier tool trials while model trials stayed separate.

Record SDK preprocessing through its download hook and forward that hook through runtime and judge calls. Replay downloaded bytes without fetching; compare request fingerprints after the same preprocessing. Keep the no-download fallback fail-closed for callers that omit the hook.

Open untrusted fixture paths with nonblocking/no-follow flags, then reject non-regular files before reading. Test a real FIFO in a subprocess with a deadline, since a blocked synchronous open prevents an in-process test timer from firing.

Derive trial scoping from combined model/tool execution, rather than relying on CLI-only configuration. Exercise the default programmatic store over two differing trials. Text-only helper tests are useful seam evidence, not proof of the complete CLI/runtime path.
