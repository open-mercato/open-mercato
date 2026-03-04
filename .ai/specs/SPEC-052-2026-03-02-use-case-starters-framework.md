# SPEC-052: Use-Case Starters Framework

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Open Mercato Team & Partners |
| **Created** | 2026-03-02 |
| **Related** | SPEC-013 (setup.ts), SPEC-041 (UMES), SPEC-045 (registry pattern), SPEC-051 (Partnership Portal), SPEC-053 (B2B PRM) |

## TLDR
**Key Points:**
- Introduce a first-class "starter" layer so engineers can bootstrap a polished use-case solution (like a B2B PRM or B2B Quotes system) instead of a blank tenant.
- Starters are **not** part of the Open Mercato core repository. They are distributed as NPM packages or standalone template repositories.
- Starters build upon `create-mercato-app`.
- Preserve UMES and module boundaries: all vertical behavior is delivered via app modules, setup hooks, widgets, enrichers, and events, built within the starter's own `src/modules` structure.

**Scope:**
- Starter definition and distribution model (external to core).
- Bootstrapping flow utilizing `create-mercato-app`.

**Concerns:**
- Keep the core absolutely clean of specific business logic or use-case templates.
- Ensure extensions built for starters fully leverage the Universal Mercato Extension System (UMES).

## Overview
Open Mercato needs productized "ready projects" that reduce time-to-first-value for common B2B use cases (for example PRM, field service, marketplace ops). Today, teams start from a generic tenant and manually assemble modules, dictionaries, workflows, and role settings.

This spec defines a framework to package those decisions into reusable starters while keeping the core platform entirely agnostic.

Market reference:
- Established vertical ERP/CRM platforms ship "industry editions" or starter kits, often built and maintained by partner agencies.
- Open Mercato adopts that model: the core remains a pristine commerce engine, while business-specific value is layered on via external starters.

## Problem Statement
Without a starter framework:
- each implementation repeats the same setup work,
- demo and pilot environments are inconsistent across teams,
- reuse is ad hoc and hard to maintain,
- sales-to-delivery handoff has no standard baseline.

If starters were integrated into the core:
- the core repository would become bloated with specific, niche configurations.
- the maintenance burden on the core team would increase dramatically.
- partner agencies would lack ownership over the specific vertical solutions they create.

The business goal is to turn repeated delivery patterns into reusable assets owned by the ecosystem, while keeping core evolution safe and lean.

## Proposed Solution
Implement a Use-Case Starters framework that relies heavily on a decentralized ecosystem:
1. **The Core Engine**: `open-mercato/core` and `create-mercato-app` remain agnostic and clean.
2. **The Starter Distribution**: Starters are standalone git templates or published NPM packages (e.g., `@agency/om-prm-starter`).
3. **The Application**: Developers use `create-mercato-app` and then layered configuration (via UMES) to apply the starter's logic within their own `src/modules`.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Starters live outside the core repository | Keeps core clean, reduces bloat, delegates domain ownership to partners/agencies. |
| Starters utilize `create-mercato-app` | Standardizes the baseline bootstrapping process before injecting business logic. |
| No new runtime extension model | Reuse UMES, events, setup.ts, entity extensions within the deployed application. |
| App-level ownership for business-specific behavior | Matches monorepo rule: user-specific features live in the generated app's `src/modules`. |

### What This Spec Explicitly Avoids
- No starter templates or configurations committed to the `open-mercato/open-mercato` core repository.
- No direct cross-module ORM relationships inside the core.
- No use-case-specific KPI ownership or API logic in the core frameworks; those rules stay in the starter's specific modules (for example, MIN attribution governance in the separate B2B PRM starter repository).
- No new core CLI commands specific to starter installation logic (other than `create-mercato-app`).

## User Stories / Use Cases
- An Engineer wants to bootstrap a new B2B PRM application. They run `npx create-mercato-app my-prm` and then install/copy their agency's PRM starter modules into the `src/` directory.
- A Partner Agency wants to distribute their specialized marketplace workflows. They bundle their UMES extensions, widgets, and `setup.ts` seeds into a shared template repository, making it easy for their team to reuse across different clients.

## Architecture

### High-Level Components
1. **`create-mercato-app` (Core)**
- Handles the initial generation of a standard, blank Open Mercato project structure.

2. **Starter Template / Package (External)**
- A GitHub repository (used as a template) or an NPM package.
- Contains pre-built `src/modules` leveraging UMES (spec 41-45).
- Includes customized dictionaries, workflows, and default setup seeds.

### Reference Flow
```text
developer runs `npx create-mercato-app my-b2b-app` ->
developer layers the specific starter logic (e.g., copies the starter's `src` folder or installs proxy NPM packages) ->
app modules register via UMES ->
`yarn initialize` runs setup hooks -> runs starter seed pack ->
app is ready with domain baseline.
```

### Starter Content Delivery (Recommended)
While distribution can vary by agency, the recommended approach for deep customization (like PRM workflows) is maintaining a **Starter Template Repository**. 

1. Dev runs `npx create-mercato-app <name>`.
2. Dev pulls down the starter template files into the working directory.
3. The specific, domain-heavy logic lives directly in the generated app's source code (`apps/mercato/src/modules/...`), giving the final implementation team complete ownership and the ability to heavily customize the code without fighting "black-box" NPM packages.

### Non-Negotiable Architecture Guardrails
1. Starter modules extend host surfaces only through UMES and documented core contracts.
2. Starter implementation lives completely outside the OM core repository.
3. The Open Mercato platform provides the extension points (hooks, enrichers, registries), but not the business configuration for starters.

## Implementation Details

Because starters are decentralized, there is no centralized database table (like `starter_installations`) required in the core engine. The "installation status" of a starter is simply the presence of its modules and configurations within the customized application codebase.

Furthermore, commands like `mercato init --starter` are unnecessary. The standard `yarn initialize` (which triggers module hooks defined in `setup.ts`) is sufficient to bootstrap the customized application.

## Migration & Compatibility
- Starters (being separate codebases) must define their compatibility with specific versions of Open Mercato Core in their `package.json` (`peerDependencies`).
- Core APIs guarantee semantic versioning, allowing starter maintainers to update their templates accordingly.

## Final Compliance Report
- Validated against core architecture principles: keep the core un-opinionated and highly extensible.
