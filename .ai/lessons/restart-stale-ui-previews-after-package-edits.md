---
title: "Restart stale UI previews after package edits"
modules: ["create_app","ui"]
areas: ["testing","debugging"]
topics: ["package-runtime","testing"]
---

# Restart stale UI previews after package edits

**Context**: an ephemeral environment started before package edits can retain stale package and Next.js artifacts → restart it with `test:integration:ephemeral:start --force-rebuild` before Playwright verification.

**Rule**: Restart the ephemeral environment with `test:integration:ephemeral:start --force-rebuild` before Playwright verification whenever it was started before package edits.
