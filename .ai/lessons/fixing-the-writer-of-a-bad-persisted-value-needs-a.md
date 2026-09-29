---
title: "Fixing the writer of a bad persisted value needs a remediation branch for values already stored"
modules: ["notifications","directory","auth"]
areas: ["backend-ui","architecture","testing"]
topics: ["data-scoping","template-sync"]
---

# Fixing the writer of a bad persisted value needs a remediation branch for values already stored

**Context**: `OrganizationSwitcher.persistTenant` wrote a blank `om_selected_tenant` cookie whenever it had no tenant. The server reads a blank cookie as a deliberate "no tenant" override and applies it to super-admin sessions, so the browser carried a self-inflicted tenant-less scope for 30 days.

**Problem**: Correcting `persistTenant` to expire the cookie only stops *new* bad writes. Every browser that already ran the previous build keeps its blank cookie until it expires, so the defect survives the fix for exactly the users who hit it. The reconciliation branch that should have cleared it was gated on `currentTenantCookie.value !== ''` — a condition that is false for a blank value, i.e. it excluded precisely the state it needed to clear — and it only reset React state without touching `document.cookie`.

**Rule**: When a fix stops a component from persisting a bad value (cookie, `localStorage`, a DB flag, a cached projection), ship a remediation path in the same change that clears the already-persisted value on the next run, and scope that path to the exact bad state rather than the general case. Deleting on every "unresolved" payload is too broad — it discards legitimate user selections; here the correct predicate was `hasCookie && value === ''`. Cover the remediation with its own test that starts from the poisoned state, since a test starting from a clean state passes with or without it.

**Applies to**: Any fix to client-side persisted state (`om_selected_tenant` / `om_selected_org` cookies, versioned `localStorage` preferences) and to server-side stored values written by a code path that is being corrected. Mirror the fix into `packages/create-app/template/` in the same change — see [Keep create-app template files in lockstep with app shell/layout changes](keep-create-app-template-files-in-lockstep-with-app.md).
