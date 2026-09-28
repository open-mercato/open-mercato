---
title: "A guard you cannot make fire is not a guard"
modules: ["marketing_automation","auth","platform"]
areas: ["architecture","testing","backend-ui"]
topics: ["access-control","command-pattern","testing"]
---

# A guard you cannot make fire is not a guard

## Four shapes of the same defect

**Context**: A new module shipped with a full gate green — typecheck, unit tests, integration
tests, DS lint, i18n checks — and a high-effort review still found four protections that could
never trigger. Each read as correct in isolation, was documented in a comment or a docblock, and
had no test that made it fire.

**Problem and rules**:

- A counter read from a field **nothing writes** is dead code that looks like a defence. A
  cascade guard read `payload._maDispatchDepth` and refused past a depth cap; nothing in the repo
  ever set that key, because the events came from the modules that own them and carry no field of
  ours. `grep` for the writer of every value a guard reads; if there is no writer, the guard is
  decoration. A guard must key off something the runtime can actually produce — here, a
  per-subject run budget the database can answer.
- A declared ACL feature is not an enforced one. `campaigns.publish` existed in `acl.ts`, was
  seeded into role defaults, was translated into five locales and appeared in
  `acl-feature-catalog.i18n.test.ts` — and no code path checked it, because the field it was meant
  to protect (`isEnabled`) travelled on an endpoint gated by a weaker feature. If a feature guards
  an action, that action needs its **own route** with a declarative `requireFeatures`, and a test
  where a principal holding the weaker grant is refused. Splitting the endpoint is what makes the
  guard mechanical instead of aspirational.
- A persisted, validated, displayed value that nothing reads at runtime is a lie told to the
  author. A scheduled campaign's `scheduleValue` was in the schema, the table, the canvas node and
  the list column, while every scheduled campaign actually ran on the module's own fixed tick. When
  a field configures behaviour, the test must assert the **behaviour differs** for two different
  values — asserting it round-trips through the API proves only that it is stored.
- Threading a token through a helper is not the same as the check receiving it. A delete path
  relied on `enforceCommandOptimisticLock` reading the expected-version header from `ctx.request`,
  and the context builder omitted `request` entirely; the platform helper silently returns when the
  expected version is absent, so the check was a permanent no-op while the client dutifully sent
  the header. Any guard that **no-ops on missing input** needs a negative test: construct the
  conflict and assert the rejection, never just assert the happy path still passes.

**Durable rule**: for every guard, write the test that makes it FIRE before the test that shows
normal traffic passing. A guard with only a passing-path test is indistinguishable from no guard,
and green pipelines actively hide it — all four of these shipped through a fully green gate.
