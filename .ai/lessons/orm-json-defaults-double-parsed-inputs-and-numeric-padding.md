---
title: "JSON column defaults, twice-parsed command inputs, and scale-padded numerics"
modules: ["eudr"]
areas: ["module-data","debugging"]
topics: ["database-migrations","command-pattern","generated-files"]
---

# JSON column defaults, twice-parsed command inputs, and scale-padded numerics

**Context**: Three separate write-path failures surfaced in the same eudr batch (2026-07-06), each invisible until a real write ran.

**Rule**:
- MikroORM `@Property({ type: 'json', default: {} })` renders the migration SQL default as the literal `[object Object]` (arrays `[]` serialize fine) — use `defaultRaw: "'{}'"` for json object defaults and re-run `yarn db:generate`.
- Command input schemas are parsed **twice** — the route's `mapInput` coerces ISO strings to `Date`, then the command re-parses the mapped input — so zod date/datetime schemas used in command inputs must accept both `string` and `Date`, or every write carrying a date field returns 400.
- PostgreSQL `numeric` columns read back scale-padded (`'100.000'`), so change-detection guards must compare numerically (`Number(a) === Number(b)`), never as raw strings, or a whole-document save echoing an unchanged quantity trips field-freeze guards.

**Applies to**: entity definitions with json columns, any command whose input carries dates or numerics, and change-detection or field-freeze guards over `numeric` columns.
