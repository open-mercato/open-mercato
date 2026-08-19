# Manufacturing Package and Module Bootstrap

## TLDR

P1.0a creates the additive OSS workspace package `packages/manufacturing`, published as `@open-mercato/manufacturing`, with sibling module entrypoints `manufacturing_base` and `manufacturing_discrete`. The bootstrap establishes build, discovery, activation, export and isolation-test mechanics only. It must not introduce Manufacturing entities, APIs, UI, migrations, WMS calls or speculative kernel contracts.

The work is tracked by [Issue #5387](https://github.com/open-mercato/open-mercato/issues/5387) under the [Wave 0 specification-readiness tracker #5386](https://github.com/open-mercato/open-mercato/issues/5386). Product implementation remains blocked until the parent roadmap is accepted in PR #5256 and this specification passes full readiness review.

## Open Questions

- **Q1:** Should P1.0a enable both modules in the standard app and `create-mercato-app` template immediately, or install the package but leave both modules opt-in until the first domain capability ships?
- **Q2:** Should initial metadata declare only `manufacturing_discrete -> manufacturing_base` as a hard module dependency, or also freeze `catalog` as a hard dependency now? WMS, `resources` and `planner` remain optional either way.
- **Q3:** Should the first package version expose only module metadata/discovery entrypoints, or also publish stable package-root domain constants/types before a capability specification requires them?

## Overview and Intended Outcome

Open Mercato currently has no workspace package that can host the accepted Manufacturing module family. Without a dedicated bootstrap slice, the first BOM, Work Center or fact-ledger implementation would have to create package mechanics and domain behavior together, obscuring dependency and compatibility review.

The bootstrap creates this topology:

```text
packages/manufacturing/                    @open-mercato/manufacturing
  src/index.ts                             package public entrypoint
  src/modules/manufacturing_base/index.ts  shared-kernel module metadata
  src/modules/manufacturing_discrete/index.ts
                                           first model module metadata
```

Both module IDs use the roadmap-approved `manufacturing_*` snake-case namespace; `manufacturing_base` is the explicitly accepted kernel identifier. It is a small shared kernel for later contracts, lifecycle primitives, facts and provider interfaces. `manufacturing_discrete` is its sibling consumer for BOM, routing and order capabilities. P1.0a creates their homes but none of those behaviors.

## Proposed Boundary

### In scope

- workspace manifest, MIT/public package metadata and repository coordinates;
- build/watch/typecheck/test configuration following an existing standalone module package;
- package exports that make enabled module source discoverable without exposing unapproved domain contracts;
- module metadata for `manufacturing_base` and `manufacturing_discrete`;
- the selected standard-app/template activation behavior from Q1;
- package dependency declarations and the selected initial module `requires` contract from Q2;
- generated-registry participation through the existing `yarn generate` mechanism;
- package-level tests plus module-decoupling assertions for sibling direction and optional peers;
- no-op/disabled behavior proving existing applications are unchanged when Manufacturing modules are not enabled.

### Out of scope

- entities, migrations, validators, commands, events, API routes, pages, navigation, ACL features or translations;
- BOM, routing, Work Center, definition-release, fact, order or stock-execution contracts;
- direct imports or ORM relationships to Catalog, WMS, Resources, Planner or Sales;
- the P1.1 `wms_sales` placement decision;
- speculative provider interfaces, reserved event IDs or placeholder implementations for later work items;
- implementation of any capability tracked by P1.4–P1.11.

## Skeleton Acceptance Outline

The full specification must demonstrate that:

1. `@open-mercato/manufacturing` builds, type-checks and packs with the same supported source/dist contract as comparable workspace packages;
2. each enabled module is discovered by generators from its own package-backed module entrypoint;
3. `manufacturing_discrete` may depend on `manufacturing_base`, while the reverse dependency is rejected;
4. neither module creates a hard requirement on optional WMS, Resources or Planner behavior;
5. disabling or omitting both modules leaves generated registries and current application behavior unchanged;
6. no product-level contract is added before its dedicated capability specification is approved;
7. app/template changes, package exports and generated-file effects are covered by focused automated tests.

The architecture, file manifest, compatibility analysis, implementation phases, detailed tests, risks and Final Compliance Report will be added only after Q1–Q3 are answered.

## Changelog

- 2026-08-19: Created the P1.0a skeleton from the approved Wave 0 specification backlog; recorded activation, initial dependency and public-export questions.
