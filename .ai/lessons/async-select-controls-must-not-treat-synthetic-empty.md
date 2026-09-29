---
title: "Async select controls must not treat synthetic empty changes as user clears"
modules: ["ui","catalog","events"]
areas: ["backend-ui","testing","module-data"]
topics: ["command-pattern","events","testing"]
---

# Async select controls must not treat synthetic empty changes as user clears

**Context**: Resource type, dictionary-backed capacity unit, and catalog variant tax selects sometimes opened with placeholders even after the saved option was fetched and seeded. The controls had no empty item in the menu, but Radix could still surface an empty `onValueChange` during the first async render where the value existed before the matching `SelectItem` was registered.

**Problem**: Forwarding `next || ''` / `next || undefined` from a select that has no explicit clear option silently erased the saved form value during hydration. Subsequent by-id option fetches could prepend the correct label, but the controlled value had already been cleared, so the edit page still looked blank while saving after manual reselection worked.

**Rule**: For required or non-clearable selects, ignore empty `onValueChange` events. If a select supports clearing, render an explicit clear command/button/item and test that behavior separately. Browser regression tests for async edit selects must assert the visible combobox trigger text, not only hidden option text elsewhere in the DOM.

**Applies to**: Radix-backed `Select` wrappers, custom `CrudForm` select components, dictionary selects, relation selects, and any async edit form whose option list may be loaded after the initial value.
