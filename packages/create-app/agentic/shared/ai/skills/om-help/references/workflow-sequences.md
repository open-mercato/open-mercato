# Workflow Sequences — Standalone App

> Common development workflows for a `create-mercato-app` project with the recommended skill sequence.  
> Load this file when the user asks "where do I start?" or "what's the order for X?".

## Table of Contents

- [New Module](#1-new-module)
- [New Feature in Existing Module](#2-new-feature-in-existing-module)
- [Extend an Existing Module](#3-extend-an-existing-module)
- [New Integration Provider](#4-new-integration-provider)
- [Fix a Bug / Something Is Broken](#5-fix-a-bug--something-is-broken)
- [PR Lifecycle](#6-pr-lifecycle)
- [Eject and Customize a Core Module](#7-eject-and-customize-a-core-module)
- [Slim Down the App](#8-slim-down-the-app)
- [Upgrade Open Mercato](#9-upgrade-open-mercato)
- [Choosing the Right Sequence](#choosing-the-right-sequence)

---

## 1. New Module

**Use when:** Building a brand-new module with its own entity, API routes, and admin pages.

```
om-data-model-design      (design entity, fields, relationships, migrations)
  → om-spec-writing       (spec the feature if non-trivial)
  → om-module-scaffold    (generate all required files)
  → om-backend-ui-design  (design forms and tables if needed)
  → om-implement-spec     (fill in business logic)
  → om-integration-tests
  → om-code-review
  → om-auto-create-pr
```

**Rationale per step:**
1. `om-data-model-design` — design entities and migrations before touching code
2. `om-spec-writing` — capture requirements, API contracts, phases (skip for simple CRUD)
3. `om-module-scaffold` — generates entity, routes, pages, ACL, DI in one pass
4. `om-backend-ui-design` — design consistent admin UI before implementing
5. `om-implement-spec` — fill in custom logic beyond what scaffold generates
6. `om-integration-tests` → `om-code-review` → `om-auto-create-pr`

> For simple CRUD modules: skip `om-spec-writing` and go directly to `om-module-scaffold`.

---

## 2. New Feature in Existing Module

**Use when:** Adding a field, endpoint, page, or behavior to a module you already have.

```
om-spec-writing           (capture requirements and API changes)
  → om-implement-spec
  → om-integration-tests
  → om-code-review
  → om-auto-create-pr
```

> For small additions (1–2 files): skip `om-spec-writing` and implement directly.

---

## 3. Extend an Existing Module

**Use when:** Adding columns, filters, menu items, API enrichments, or UI changes to a *core* OM module without modifying its source.

```
om-system-extension       (use UMES: enrichers, widgets, interceptors, guards, event subscribers)
  → om-code-review
  → om-auto-create-pr
```

**Rationale:** Always try `om-system-extension` first. UMES mechanisms cover most extension needs and survive upgrades. Only fall back to `om-eject-and-customize` if UMES cannot solve the problem.

**Extension mechanisms by use case:**

| What you want to do | UMES mechanism |
|--------------------|----------------|
| Add a column to a list table | Field/Column Widget |
| Add a field to a form | Field Widget |
| Add a filter to a data table | Filter Widget |
| Add data to an API response | Response Enricher |
| Block or validate a mutation | Mutation Guard |
| Hook before/after an API call | API Interceptor |
| Replace a UI component | Component Replacement |
| Add a menu item | Menu Injection Widget |
| React to a domain event | Event Subscriber |

---

## 4. New Integration Provider

**Use when:** Connecting to a payment gateway, shipping carrier, data-sync service, or external API.

```
om-spec-writing           (design adapter contract, credentials, health check)
  → om-integration-builder (scaffold provider package)
  → om-implement-spec     (fill in provider logic)
  → om-integration-tests
  → om-code-review
  → om-auto-create-pr
```

---

## 5. Fix a Bug / Something Is Broken

**Use when:** Module not loading, widget not appearing, migration failing, build error, "it doesn't work".

```
om-troubleshooter
  → om-code-review        (after fix is in place)
  → om-auto-create-pr
```

**Rationale:** `om-troubleshooter` follows a systematic diagnostic flow. Start there — don't guess. It covers module issues, entity/migration issues, API routes, UI/widgets, build/type errors, and database problems.

---

## 6. PR Lifecycle

**Use when:** Shipping work as a GitHub PR.

```
om-auto-create-pr
  → om-auto-review-pr
```

Or for long/resumable work:
```
om-auto-create-pr-loop
  → om-auto-continue-pr-loop   (if interrupted)
  → om-auto-review-pr
```

---

## 7. Eject and Customize a Core Module

**Use when:** UMES extensions (see sequence 3) cannot solve the problem and you need to modify core module source directly.

```
om-eject-and-customize    (pre-ejection analysis, identify safe zones, document customizations)
  → om-implement-spec     (implement modifications)
  → om-code-review
  → om-auto-create-pr
```

**Warning:** Ejected modules require manual diff tracking on upgrades. Only eject when necessary.

---

## 8. Slim Down the App

**Use when:** Fresh `create-mercato-app` scaffold enables all modules by default; you want to disable unused ones.

```
om-trim-unused-modules
  → om-code-review
  → om-auto-create-pr
```

---

## 9. Upgrade Open Mercato

**Use when:** Bumping the framework version in your app.

```
om-auto-upgrade-0.4.10-to-0.5.0   (for 0.4.10 → 0.5.0)
  → om-code-review
  → om-auto-create-pr
```

For other version jumps, check the `UPGRADE_NOTES.md` in your project.

---

## Choosing the Right Sequence

| Situation | Sequence |
|-----------|----------|
| I want to build a new module | [New Module](#1-new-module) |
| I want to add something to an existing module I own | [New Feature in Existing Module](#2-new-feature-in-existing-module) |
| I want to customize a core OM module | [Extend an Existing Module](#3-extend-an-existing-module) (try UMES first) |
| I want to add a payment/shipping/sync integration | [New Integration Provider](#4-new-integration-provider) |
| Something is broken | [Fix a Bug / Something Is Broken](#5-fix-a-bug--something-is-broken) |
| I want to open a PR | [PR Lifecycle](#6-pr-lifecycle) |
| UMES can't solve my extension need | [Eject and Customize](#7-eject-and-customize-a-core-module) |
| I want to remove unused modules | [Slim Down the App](#8-slim-down-the-app) |
| I need to upgrade OM version | [Upgrade Open Mercato](#9-upgrade-open-mercato) |
| I'm not sure what I need | Start with `om-help` |
