---
title: "Optional chrome fetches must suppress auth redirects"
modules: ["auth","notifications","ui"]
areas: ["backend-ui","umes"]
topics: ["access-control","testing","ui-components"]
---

# Optional chrome fetches must suppress auth redirects

**Context**: Backend pages for limited roles loaded unrelated optional shell data, such as message sender options, recipient suggestions, and AI conversation history. Those auxiliary requests hit feature-gated endpoints the current user was not meant to access.

**Problem**: `apiCall` redirects the whole browser to `/login?requireFeature=...` on 403 by default. Optional header/sidebar/widget fetches can therefore break an otherwise authorized page when they call APIs for another module's feature, even if the caller handles `ok: false`.

**Rule**: Any optional chrome, widget, dropdown-options, background sync, or feature-discovery request that is not required to render the current page must opt out of auth redirects with `x-om-forbidden-redirect: 0` and usually `x-om-unauthorized-redirect: 0`, then degrade to an empty/hidden state on non-OK responses.

**Applies to**: `packages/ui/src/backend/**`, `packages/ui/src/ai/**`, topbar/sidebar providers, notification/message/AI shell hooks, and module widgets that fetch feature-gated data opportunistically.
