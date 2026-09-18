---
title: "Write-only secret editors need explicit unchanged intent and separate form state"
modules: ["integrations","ui"]
areas: ["backend-ui","integration","testing"]
topics: ["data-integrity","ui-components","testing"]
---

# Write-only secret editors need explicit unchanged intent and separate form state

**Context**: Integration credential GET masked configured secrets with an opaque sentinel and returned a separate configured-state map. Generic credential editors copied the masked object into password inputs, so the sentinel became real editable text.

**Problem**: Partial edits persisted hybrid sentinel/user strings as encrypted credentials. Reinterpreting every omitted secret as unchanged would have fixed the first-party form while breaking the stable full-blob replacement contract, clear-all clients, deliberate provider clears, and a widget context that already consumed the raw masked map. A duplicate bundle editor had the same prefill path.

**Rule**: Keep the raw masked response for existing transport and extension contracts, derive separate empty form values from configured-state metadata, and submit an explicit bounded list of unchanged secret field names. The server intersects that intent with trusted schema secret types; plain omission keeps its prior replacement semantics and explicit values always win. Audit every generic editor, extension context, clear path, and integration test before changing shared secret behavior.

**Applies to**: Integration credentials, write-only settings forms, password/token replacement inputs, full-blob APIs, bundle editors, and any masked-secret contract with generic UI rendering.
