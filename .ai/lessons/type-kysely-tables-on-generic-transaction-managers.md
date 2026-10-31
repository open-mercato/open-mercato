---
title: "Type Kysely tables on generic transaction managers"
modules: ["shared", "entities"]
areas: ["module-data", "testing"]
topics: ["kysely", "transactions", "typechecking"]
---

# Type Kysely tables on generic transaction managers

An advisory-lock callback receives a generic `EntityManager`; its entity metadata
does not infer the custom document-storage table for `getKysely()`. In PR #8163,
the query passed transpilation and unit tests but failed the app's TypeScript
check with table and operand types inferred as `never`.

Pass a narrow database shape to `txEm.getKysely<Database>()`, including nullable
scope columns. Type raw SQL expressions for JSON documents and timestamps to
match the insert columns. Keep the query on `txEm` so the types do not disguise
a write outside the lock transaction. Package bundling and transpiled Jest tests
do not replace a successful typecheck.

Evidence: `packages/shared/src/lib/data/engine.ts` create-only custom-record path;
[PR #8163 prepare failure](https://github.com/open-mercato/open-mercato/actions/runs/40791039596/job/123176037888).
