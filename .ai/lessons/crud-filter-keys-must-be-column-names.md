---
title: "A CRUD list filter key is a column name, not a property name"
modules: ["hr_management","fleet_management","create_app","shared","core"]
areas: ["module-data","testing","integration"]
topics: ["auto-discovery","error-states","crud-forms"]
---

# A CRUD list filter key is a column name, not a property name

Twelve CRUD list routes across `hr_management` and `fleet_management` shipped with **every filter
silently disabled** — 31 filter keys, including the search boxes and the dropdowns the new screens
were built around. Nothing failed: `tsc`, lint, jest, `yarn generate` and the dictionary gates were
all green, and every screen rendered. The tables simply came back empty whenever a filter was used.

Measured on a running app, same route, same session, same value:

| Request | Result |
|---|---|
| `GET /api/hr_management/employees?departmentId=<uuid>` | `items: []`, `total: 0` |
| `GET /api/hr_management/employees?department_id=<uuid>` | the row |
| `GET /api/hr_management/employees?status=active` | the row (one word, so both spellings agree) |

## The two spellings that must not be confused

A list route has **two** key vocabularies and they look alike:

| Surface | Vocabulary | Example |
|---|---|---|
| the query string (the route's `listSchema`) | camelCase — it is the public API contract | `?departmentId=` |
| the object `buildFilters` returns | the **column name** | `{ department_id: { $eq: … } }` |

`buildFilters` output is resolved against the entity's *fields*, so a key that is only a property
name reaches the query and matches nothing. The schema's `.passthrough()` accepts the camelCase query
parameter, the filter builder drops it, and the request succeeds with zero rows — the one failure a
screen cannot distinguish from "this department has no employees yet".

`sortFieldMap` is the opposite and stays camelCase: its keys are the client's sort ids and its *values*
are the columns.

## Why nothing caught it

- the filter object is `Record<string, unknown>` — no type knows a column from a property;
- the route's own unit tests exercise the schema and the payload, never a live row;
- the build and the dictionary checks have no opinion about SQL identifiers;
- and an empty page looks exactly like an empty table.

Only a query with a **known row** and a **negative control** exposes it: filter for the fixture and
assert the sibling fixture is absent.

## Adjacent trap, same investigation

Sweeping the filters also surfaced two write-side and query-side bugs:

- A handover command created its odometer log before flushing the assignment, so `assignment.id` was
  still unset and the log stored `assignment_id = NULL`. A freshly created entity has no primary key
  until the flush assigns one — read its id after `persist(...).flush()`, or load the row first as the
  return path did.
- `isActive: z.coerce.boolean()` looked right and read the string `'false'` as `true`
  (`Boolean('false')` is truthy), so `?isActive=false` returned the active rows. A boolean query
  parameter needs the tokens spelled out (`hr_management/lib/queryBoolean.ts` accepts
  `true`/`false`/`1`/`0` and rejects anything else) — never a coercion.

## Rules

- Filter keys in `buildFilters` are **column names** (`snake_case`); query parameters stay camelCase.
- Add every user-visible filter to the live contract test with a positive **and** a negative fixture.
- `packages/core/src/__tests__/crud-filter-keys.test.ts` fails the build on a camelCase filter key in
  the app modules and the create-app template. It deliberately scans only those trees: several core
  routes pair camelCase keys with an indexer, and whether the query engine resolves them is unsettled.
- A null foreign-key column is worth an explicit assertion; a log row that points at nothing still
  renders, it just cannot be joined to anything.
