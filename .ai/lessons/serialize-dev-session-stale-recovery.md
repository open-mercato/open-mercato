---
title: "Serialize dev-session stale recovery across ownership changes"
modules: ["create_app"]
areas: ["architecture","testing","debugging"]
topics: ["dev-runtime","concurrency","template-sync"]
---

# Serialize dev-session stale recovery across ownership changes

**Context**: PR #8100 introduced workspace ownership for development launchers.

**Problem**: Two launchers could observe the same dead owner. After one replaced the stale lock with a live session, the delayed launcher could remove that new session using its old observation. A test starting with no lock did not exercise this interleaving.

**Rule**: Serialize stale inspection, removal, acquisition, and release through a private acquisition gate. Publish initialized ownership atomically. Recover a dead gate with a generation-specific retained tombstone so a delayed recoverer cannot rename a newer live gate. Keep root and scaffolded runtime copies identical.

**Verification**: Pause one launcher immediately before stale removal, start a contender, then resume. Exactly one must acquire ownership. Also cover dead-gate recovery, bounded waits, and normal gate cleanup on success, conflict, and release.
