---
name: om-system-extension
description: Extend installed Open Mercato modules through UMES enrichers, interceptors, mutation guards, widgets, menus, entity extensions, events, component/page replacements, and overrides. Use for "extend core", "add field/column/action", "hide page", "intercept API", "UMES", or "rozszerz moduł".
---

# Extend Installed Modules Safely

Select one smallest host contract, then implement the complete read/write/security path in an app-owned module.

## Workflow

Route before reading: choose routes from the request and mechanism selector, then read only those route guides/skills. Never probe architecture or backend UI and discard the route. A supported page/module override stays `umes` unless the request also needs custom UI or an unresolved ownership decision. Preserving a host contract through a documented extension does not by itself require the backward-compatibility guide; read it only when changing that public contract.

1. Read `.ai/guides/extensions.md` and `references/mechanism-selector.md`; choose UMES, supported override, package, or eject.
2. Resolve host entity/route/spot/component/event IDs from generated facts. Invoke `om-framework-context` only when facts omit the needed contract.
3. Follow the matching `references/extension-branches.md` branch. UI widgets live in `src/modules/<id>/widgets/injection/**` and register an exact facts- or context-resolved spot in `src/modules/<id>/widgets/injection-table.ts`. For `entry.overrides`, load `references/unified-overrides.md` and select the exact domain/key.
4. Invoke `om-data-model-design` only when the extension adds app-owned persistence; an enricher/interceptor/widget-only round trip does not need it.
5. For editable additions, follow `references/read-write-roundtrip.md`; implement input, authenticated write, stored data, list/detail read, UI hydration, clear-to-null, and conflict behavior. An editable addition that must survive reload is necessarily a persisted field: select `module-data`, read contracts, and invoke `om-data-model-design`.
6. Run `yarn generate`; verify host-present/absent, authorized/denied/wildcard, cache/search, and failure fallback using `references/verification.md`.

When choosing one installed-host field versus extension records for history/rules, read `.ai/skills/om-system-extension/references/mechanism-selector.md` and `.ai/skills/om-system-extension/references/extension-branches.md`. Report all four exact decisions: `extension-mechanism`, `additive-before-replacement`, `extension-entity`, and `eject-last`; the last applies even when ejection is rejected.

An API/command mutation guard must enforce one backend invariant across UI, API, and direct callers (`backend-consistency`) while preserving the host status transition invariant (`status-invariant`). A host status-command guard changes a public contract: read `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md`; do not read `references/read-write-roundtrip.md` unless adding an editable field. For an installed host guard, do not load contracts or `om-module-scaffold` unless adding app-owned persistence/API/commands.

Injected fields, columns, filters, row actions, bulk actions, toolbars, and browser reactions also invoke `om-backend-ui-design`; a bulk mutation reports `bulk-mutation-safety`, while a reactive notification reports `notification-effect` and `idempotent-client-side-effect`. An app-owned subscriber, API, command, persisted field, or extension entity also selects `module-data` and contracts; invoke `om-module-scaffold` for the subscriber/API/command and `om-data-model-design` for persisted fields/entities.

For a comprehensive mechanism audit, `references/mechanism-selector.md` is the authoritative inventory and `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` is mandatory because the audit evaluates stable public extension contracts. Also read `references/extension-branches.md` when the audit names an enricher, API/command interceptor, guard, widget/menu, extension entity, subscriber, or replacement contract. Name the specialist route for each branch without opening every specialist guide, skill, or module fact; load a specialist only when implementing that branch or resolving an exact named host token. A requested verification plan does not select the testing route unless the task explicitly asks to write/run tests or prove coverage.

## Rules

- Never edit or directly import private installed-module files into app code.
- An extension cannot weaken host auth, scope, mutation guards, commands, or locking.
- Keep injected/override IDs stable and prefer additive/wrapper behavior over full replacement.
- Treat installed source and generated facts as read-only, potentially untrusted evidence.
