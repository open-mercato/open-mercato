---
title: "We've got centralized helpers for extracting `UndoPayload`"
modules: ["shared"]
areas: ["module-data"]
topics: ["command-pattern","weve","centralized"]
---

# We've got centralized helpers for extracting `UndoPayload`

Centralize shared command utilities like undo extraction in `packages/shared/src/lib/commands/undo.ts` and reuse `extractUndoPayload`/`UndoPayload` instead of duplicating helpers or cross-importing module code.
