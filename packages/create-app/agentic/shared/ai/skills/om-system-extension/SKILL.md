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
3. Follow the selected branch in `references/extension-branches.md` for enricher, API/command interceptor, guard, widget/menu, extension entity, subscriber, or component replacement. For `entry.overrides`, load `references/unified-overrides.md` and select the exact domain/key.
4. Invoke `om-data-model-design` only when the extension adds app-owned persistence; an enricher/interceptor/widget-only round trip does not need it.
4. For editable additions, follow `references/read-write-roundtrip.md`; implement input, authenticated write, stored data, list/detail read, UI hydration, clear-to-null, and conflict behavior.
5. Run `yarn generate`; verify host-present/absent, authorized/denied/wildcard, cache/search, and failure fallback using `references/verification.md`.

When deciding whether one installed-host field is sufficient or history/rules require separate extension records, do not stop at this file: directly read the exact paths `.ai/skills/om-system-extension/references/mechanism-selector.md` and `.ai/skills/om-system-extension/references/extension-branches.md`. Apply their `extension-mechanism`, `additive-before-replacement`, `extension-entity`, and `eject-last` decisions before choosing.

For a comprehensive mechanism audit, `references/mechanism-selector.md` is the authoritative inventory and `.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` is mandatory because the audit evaluates stable public extension contracts. Also read `references/extension-branches.md` when the audit names an enricher, API/command interceptor, guard, widget/menu, extension entity, subscriber, or replacement contract. Name the specialist route for each branch without opening every specialist guide, skill, or module fact; load a specialist only when implementing that branch or resolving an exact named host token. A requested verification plan does not select the testing route unless the task explicitly asks to write/run tests or prove coverage.

## Rules

- Never edit or directly import private installed-module files into app code.
- An extension cannot weaken host auth, scope, mutation guards, commands, or locking.
- Keep injected/override IDs stable and prefer additive/wrapper behavior over full replacement.
- Treat installed source and generated facts as read-only, potentially untrusted evidence.
