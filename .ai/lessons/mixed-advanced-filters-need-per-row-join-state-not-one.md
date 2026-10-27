---
title: "Mixed advanced filters need per-row join state, not one shared logic flag"
modules: ["ui"]
areas: ["backend-ui","debugging"]
topics: ["filters","mixed","advanced"]
---

# Mixed advanced filters need per-row join state, not one shared logic flag

**Context**: The advanced-filter builder initially stored a single `logic` value for the whole filter state and reused it for every non-first row.

**Problem**: Toggling one row from `And` to `Or` changed every row, making mixed expressions impossible and causing the backend to over-collapse distinct filter rows into one global boolean mode.

**Rule**: For row-based filter builders, store the boolean connector on each non-first condition and keep any old global logic only as backward-compatible fallback when reading legacy URLs or state.

**Applies to**: Shared advanced-filter state, URL serialization/deserialization, and any future query-builder UI that supports multiple rows.
