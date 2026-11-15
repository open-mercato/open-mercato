---
title: "Client injection hooks must tolerate late registry registration"
modules: ["cli","cache","ui"]
areas: ["umes","architecture","integration"]
topics: ["generated-files","database-migrations","provider-lifecycle","data-scoping"]
---

# Client injection hooks must tolerate late registry registration

**Context**: The integrations detail page relied on provider-injected tabs for webhook settings and aggregated logs. In the browser, generated injection tables and widgets were present, but some pages could still render without injected content on the first client pass.

**Problem**: `useInjectionWidgets()` and `useInjectionSpotEvents()` could read the injection registry before client bootstrap finished registering generated tables/widgets, cache an empty result, and never retry. That left valid widgets invisible until a hard refresh or unrelated rerender.

**Rule**: Client-side injection hooks must react to registry registration changes. When bootstrap registers core injection widgets/tables, invalidate loader caches and notify hooks so they reload instead of permanently caching an empty registry snapshot.

Loading consumers must also distinguish an unregistered registry from a registered empty registry. Keep the initial loading signal active until both widget entries and injection tables are registered; a successful empty lookup before bootstrap finishes must not release a table's initial column layout. Recheck the registry version after subscribing so registration between render and effect cannot be missed. Publish terminal bootstrap failures through that same notification path, release loading with empty widgets plus an error, and clear the failure only after a successful registration retry; a rejected chunk must not leave every base table loading forever.

Keep definition-query identity stable during same-scope row refreshes and invalidate the populated query instead of replacing it with a new reload-counter key. Use persisted selection cookies only as the private first-emission comparison baseline so matching switcher hydration does not look like a scope change. Keep public scope unresolved until the switcher's first validated event; otherwise early form submissions serialize unvalidated cookie scope. Test real scope hooks through early payload submission as well as cache versions. Actual tenant/organization changes must still select a fresh query and must not carry definitions across scopes. Raw-table hosts must consume the same injected-column readiness signal before exposing their first header.

**Applies to**: `packages/shared/src/modules/widgets/injection-loader.ts`, `packages/ui/src/backend/injection/InjectionSpot.tsx`, and any future client hook that reads generated registries during hydration.
