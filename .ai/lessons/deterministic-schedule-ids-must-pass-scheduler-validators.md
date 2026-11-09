---
title: "Deterministic module schedule ids must be valid for scheduler validators"
modules: ["scheduler"]
areas: ["module-data","architecture"]
topics: ["validation-errors","data-integrity"]
---

# Deterministic module schedule ids must be valid for scheduler validators

**Context**: Module-registered schedules derive a stable id from a sha256 hash formatted as 8-4-4-4-12 hex.

**Problem**: Postgres `uuid` accepts any 8-4-4-4-12 hex value, so the schedule is stored and runs. Zod `z.uuid()` enforces RFC 4122 version/variant bits, so the trigger API rejects the same id and the schedule cannot be run manually (upstream #7152 / #7157).

**Rule**: When generating deterministic UUID-shaped ids, set the RFC 4122 version and variant bits (for example, v5-style), or validate such ids with `z.guid()` where any UUID-shaped value is legitimate. Add a test that round-trips a generated id through every validator that accepts it.

**Applies to**: scheduler schedule registration, scheduler API validators, and any hash-derived id stored in a `uuid` column.
