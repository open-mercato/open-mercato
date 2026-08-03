---
title: "Anchor repeated route-handler edits to unique context"
modules: ["messages"]
areas: ["debugging","testing"]
topics: ["route-coverage","testing"]
---

# Anchor repeated route-handler edits to unique context

**Context**: The messages item route contains similar participant-authorization blocks in multiple HTTP handlers. A broad patch intended for `DELETE` matched the earlier `GET` block instead.

**Problem**: Repeated route structure makes line-only patch context ambiguous. A syntactically valid edit can land in the wrong handler, changing unrelated behavior while leaving the intended endpoint unfixed.

**Rule**: When editing repeated route-handler blocks, anchor the change to the target exported handler and a nearby statement unique to that handler. Review the handler-scoped diff and run focused route tests before continuing.

**Applies to**: Route files that colocate multiple HTTP handlers with similar authorization, loading, mutation-guard, or response sequences.
