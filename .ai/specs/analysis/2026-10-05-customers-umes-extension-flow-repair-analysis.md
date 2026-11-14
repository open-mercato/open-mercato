# Pre-implementation analysis: Customers UMES extension flow repair

Spec: [Customers UMES extension flow repair](../2026-10-05-customers-umes-extension-flow-repair.md)
Baseline: upstream/develop a108dd07f4. Issue: #6736.

## Readiness

Ready after the independent GPT-6.1 Sol review's three corrections were incorporated: await create contributor callbacks before navigation; use the child version loaded with the form and advance it after a successful child write; use embedded CrudForm for full deal creation with exactly one native mutation guard. These decisions were made before the implementation packets were dispatched. Existing non-atomic contributor-before-native ordering remains an explicitly documented limitation.

## Backward compatibility audit

The current repository policy contains fourteen categories; the older skill's thirteen-category checklist was extended accordingly.

| Protected surface | Result |
| --- | --- |
| Auto-discovery conventions | Existing files/exports retained; source registries regenerated. |
| Public interfaces | Optional props, context fields and submit-result fields only. |
| Function signatures | Void submit callbacks remain supported; existing required inputs retained. |
| Import paths | No moves or removals. |
| Event IDs | Existing lifecycle event IDs and save order retained. |
| Injection spot IDs | Existing canonical, legacy, header, badge, footer and native group IDs retained; new hosts and aliases additive. |
| API URLs/envelopes | Existing routes/native fields retained; contributor namespaces and owning child metadata additive. |
| Database schema | No entity, migration or snapshot changes. |
| DI tokens | Existing cache/RBAC/enricher services reused. |
| ACL IDs | Existing grants and wildcard matching reused; no feature changes. |
| Notification IDs | Unaffected. |
| AI/tool/UI-part/override IDs | Existing CrudForm/DataTable override IDs retained; actual fallback runtime bound. |
| CLI commands | Unaffected. |
| Generated contracts | No manual generated edits or exported-contract changes. |

No compatibility violations or deprecation bridges beyond the existing create-spot bridge were found.

## Completeness and repository compliance

All required spec sections are present, including scoped detail API contracts, failure recovery, native group aliases, integration coverage, risk review, phasing, migration policy and changelog. Changes belong in shared/UI/core packages, except updates to the existing Example contributor and its create-app mirror. Native write payloads remain whitelisted. No ORM relationship, new PII field, encryption implementation, direct SQL, raw client fetch, dependency or custom mutation framework is introduced. Existing permission checks precede trusted-scope enrichment; existing runner module/feature filters apply on cold reads and cache hits.

Forms use CrudForm and shared HTTP helpers; custom group controls consume its state. Existing keyboard behavior is preserved. New hosts use shared layout primitives and existing translations; the owning-create failure message is synchronized across all five Example locales and the template mirror. The lessons on real mounted hosts, wildcard grants, late registry registration and guarded mutations are addressed by regression coverage. Live-browser feedback tests also require contributor failures to remain visible after native success.

## Risk assessment and remediation

| Risk | Severity | Required evidence |
| --- | --- | --- |
| Shared lifecycle duplicates or missing headless participants | High | Real registry tests for counts, rendered/headless ordering, wildcard/module filtering, canonical/legacy deduplication and late bootstrap. |
| Cached permission-filtered or stale contributor data | High | Exported route cold/hit tests, cloned base objects, changed grants and child values, critical errors outside fallback catches. |
| Weak or self-conflicting version baselines | High | Own-child captured version, stale-child rejection, child-success/native-failure retry and parent guard identity tests. |
| Create callback/navigation race | High | New-ID after-save context, delayed callback order and exactly one native creation. |
| Group/tab renderer loss or disappearing selection | Medium | All renderers preserved, native collisions appended, unavailable selection corrected after readiness. |
| Missing/empty sidebar and narrow layout | Medium | Real mounted host, enabled integrations data, absent contributors and one mobile form. |
| Overlap with #5915/#5415/#6004 | Medium | Preserve existing bridges; omit new payload transport; reuse intended create-host test identity. |

No unresolved design gaps block implementation. Completion requires ordered repository validation, real enabled-contributor browser round trips and an independent code review; this document does not assert those later gates have passed.
