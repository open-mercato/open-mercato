# Marketing Automation — Phased Delivery

| Field | Value |
|-------|-------|
| **Status** | Specification (rev 1) — decision requested |
| **Created** | 2026-10-02 |
| **Modules** | `marketing_automation` (`packages/marketing-automation`) |
| **Related** | The module spec, the full-port roadmap and the journey exit criteria, all in this PR |
| **Migration** | One migration per phase; the single squashed migration is split along the same lines. |

---

## TLDR

**Key points:**
- The review asks for this module to arrive as PRs 0–6, each with its own spec and migration.
  That premise assumed a decomposition **the dependency graph does not permit**, and this spec
  reports the measurement rather than delivering a cut that pretends otherwise.
- Good news first: the module's internal import graph is a **clean DAG** — 228 files, 607 internal
  edges, **zero cycles**, nine dependency layers. And the 23 entities have **zero ORM relations**
  between them, so `data/entities.ts` and the migration split along any boundary.
- A five-phase cut with **zero back-edges** exists and is buildable. But the first phase is
  **166 of 228 files and 20,646 of 30,231 source lines (68%)**, and the remaining four come to
  9, 10, 32 and 11 files. Phasing yields four small reviewable PRs and one large one — not five
  comparable ones.
- The cause is specific and measurable: `lib/dispatcher.ts` imports **one function each** from
  consent, preferences, the subject document, segments, tiers, GDPR erasure and the learned send
  hour. Seven one-function imports pull in seven feature closures.
- Inverting those twelve edges into registrations — an idiom this module already uses for steps and
  sweep sources — moves phase 1 to **137 files / 15,719 lines (52%)**. Meaningful, not
  transformative: the engine, the entities, campaign CRUD and the canvas are irreducibly about half
  the module.

**Decision requested:** phase as measured (packaging only, no behaviour change), or invert the
twelve edges first, or neither — and review the single PR in the stated order.

---

## How this was measured

`dependency-cruiser` over `packages/marketing-automation/src/**/*.ts`, excluding tests and
integration specs, restricted to edges inside the module. Tarjan's algorithm for strongly connected
components; longest-path layering over the condensation. Scripted rather than eyeballed, because the
question — "can phase N avoid importing from phase N+1" — is exactly the kind a reading of 228 files
answers wrongly.

Entry points (API routes, backend pages, workers, subscribers, steps) are placed at the latest phase
they depend on, rather than claimed by path. Claiming them by path was the first attempt and produced
**78 false back-edges**, all of them routes like `campaigns/[id]/render` that a prefix rule had swept
into the core.

### What the graph says

| Measurement | Value |
|---|---|
| Internal files | 228 |
| Internal edges | 607 |
| Cyclic components | **0** |
| Dependency layers | 9 |
| ORM relations between this module's own entities | **0** |
| Source lines | 30,231 |
| Unit test lines | 13,820 |
| Integration spec lines | 9,502 |
| Locale lines | 4,181 |

The zero-cycle result matters: it means any cut that respects the layering is mergeable in order,
with no stubs and no file reviewed twice. The zero-ORM-relations result matters for the same reason
on the data side — entities are joined by plain FK ids, following the platform's own convention, so
splitting the entity file and the migration costs nothing structurally.

## Correction: these numbers moved twice, and why

The first version of this spec reported phase 1 at **68.3%** and the inverted variant at **52.0%**. Both were
wrong, in the same direction, for one reason: the measurement used `dependency-cruiser` over
`src/**/*.ts`, and the package's cruiser config filters by extension. That glob silently omitted every `.tsx`
file — **23 backend screens**, almost all of which belong to phase 1. The script now builds its own import
graph so the extension can never filter the answer again, and it ships beside this spec so the figures can be
re-derived rather than taken on trust.

The inverted figure moved for a second reason. It was 52% while `MarketingConsent` and
`MarketingContactPreference` were allowed to follow the graph into phase 2 — which they must not, because a
phase that can send without consent is a phase that mails people who said no, and a merged phase is a
shippable state. With consent pinned to phase 1 the honest figure is **64.4%**.

So the inversion buys **9.3 percentage points and moves four tables**, for a refactor of the enrolment core.
That is the trade as measured, and it is why the delivery does not take it.

## The phases

Ordered so each depends only on earlier ones. Verified: **zero back-edges**.

| Phase | What it is | Files | Source lines | Share |
|---|---|---|---|---|
| **P1** | A campaign runs: entities, validators, ACL, the engine, the dispatcher, runs and claims, the canvas, campaign CRUD, the sweep, consent and the contact preference — plus everything else the dispatcher consults (see below) | 190 | 28,431 | 73.7% |
| **P2** | Tracking, the public pages, the portal preference centre, content blocks | 7 | 1,028 | 2.7% |
| **P3** | Results: the daily series, the funnel, links, attribution, A/B results | 12 | 2,254 | 5.8% |
| **P4** | Segments, score rules, referrals, price watches, lead routing | 32 | 4,870 | 12.6% |
| **P5** | The authoring agent, AI copy, inbound hooks | 11 | 1,975 | 5.1% |

Phase 0 is not in this table: it is platform work, outside this package. See **What phasing does not
fix**.

## Why phase 1 is two thirds of the module

`lib/dispatcher.ts` is the enrolment path, and it asks exactly one question of each of seven
features:

| It imports | From | Because |
|---|---|---|
| `isSuppressedByConsent` | `lib/consent.ts` | permission, which must be checked before anything is sent |
| `loadContactPreference` | `lib/preferences.ts` | what the recipient themselves asked for |
| `buildSubjectDocument`, `loadSubjectTimeZone` | `lib/subject-document.ts` | the audience is evaluated against it |
| `loadSegmentDefinitions` | `lib/segments.ts` | an audience may reference a saved segment |
| `loadTierThresholds` | `lib/tiers.ts` | the document carries the subject's tier |
| `isErasedSubject` | `lib/gdpr.ts` | an erased person is not enrolled |
| `loadPreferredSendHour` | `lib/analytics/send-time.ts` | the learned hour, when no hour is authored |

None of these is optional for a phase that enrols anybody. A phase 1 without consent is a phase that
sends marketing email without checking permission — not something to merge as an intermediate state,
behind a flag or otherwise.

So the size is not an accident of packaging, and it is not padding. It is what "a campaign runs"
costs in this design.

### The lever, and what it is worth

Each of those is one narrow function, so each edge is invertible: the feature **registers** its gate,
its document contribution or its threshold loader, and the dispatcher consults a registry instead of
importing a module. This module already works that way for step types (`registerMarketingSteps`) and
for periodic candidate sources (`ROW_SWEEP_SOURCES`), so the idiom is native rather than imported.

Measured, with those twelve edges inverted:

| Phase | Files | Source lines | Share |
|---|---|---|---|
| P1 | 168 | 24,827 | 64.4% |
| P2 | 17 | 2,139 | 5.5% |
| P3 | 14 | 2,771 | 7.2% |
| P4 | 42 | 6,846 | 17.8% |
| P5 | 11 | 1,975 | 6.5% |

Phase 1 drops by about five thousand lines. It is still half the module, because the engine, the
entities, campaign CRUD and the canvas are half the module whatever the dispatcher imports.

The honest case for doing it is therefore **not** PR size. It is that a registry makes the gates
extensible — a third-party module could contribute a suppression rule or a document key — which is
the platform's whole thesis, and which the current shape forbids. That case should be argued on its
own merits, in its own spec, not smuggled in as a packaging fix.

## What phasing does not fix

**Reviewability is halved, not solved.** Phase 1 is 20,646 source lines; with its share of tests and
locales it is roughly forty thousand. That is better than the whole PR and still more than anybody
reviews carefully. Four genuinely reviewable PRs get peeled off; the core does not become small.

**`requires` stays hard.** `ModuleInfo.requires` is `string[]`, validated in
`packages/cli/src/lib/generators/module-registry.ts` with `process.exit(1)`, and the platform has no
optional form — so "sales and catalog are optional" cannot be expressed today at any phase. That is
phase 0 and it is a platform change to a contract surface, which `BACKWARD_COMPATIBILITY.md` governs.

**The cross-module reads remain.** They are now declared in one place and guarded
(`lib/external/tables.ts`), so the coupling is enumerable and cannot grow unnoticed. Making it
optional needs the data contract that phase 0 would introduce.

## Migration & Backward Compatibility

The single `Migration20260930144604_marketing_automation.ts` splits into one migration per phase,
each creating only its phase's tables. Safe because no entity holds an ORM relation to another, so
there are no FK constraints between phases to order. No installation has run any of these
migrations outside development, and the module is opt-in and off by default, so there is no upgrade
path to preserve and nothing to dual-write.

Per-phase specs: P1 reuses the module spec, P2–P5 take the relevant sections out of it, and the
roadmap stays whole as the forward-looking document.

## Integration coverage

The existing specs are already per-feature, so they travel with their phases: `TC-MA-001..019` with
P1 and P2, `TC-MA-020` and the AI specs with P5, `TC-MA-023..027` with P4, the results specs with P3.
Each phase PR must land green on its own, which the fork gate enforces per branch.
