---
name: om-trim-unused-modules
description: Analyze and disable unused built-in modules in a standalone app without breaking dependencies, navigation, backend landing, bootstrap, or generation. Use for "trim classic mode", "remove unused modules", "slim app", "disable built-ins", or "wyłącz moduły".
---

# Trim Built-Ins Safely

Propose a dependency-aware set first; edit `src/modules.ts` only after the user accepts the set.

## Workflow

1. Read `references/dependency-and-redirect.md`, `src/modules.ts`, package dependencies, generated module facts, and app imports/overrides.
2. Classify each module as required, optional-used, optional-unused, or uncertain. Keep dependencies, auth/setup, and host modules for active extensions/providers.
3. Present the proposed disabled set and effects; ask for confirmation when the request did not name exact modules.
4. Disable through `src/modules.ts`/supported configuration. Remove only app-owned references made invalid by the decision.
5. If dashboards is disabled, update the backend landing route to the first accessible enabled page with profile as last fallback.
6. Run `yarn generate`, structural cache purge if available, typecheck/build, login/backend navigation, setup, CLI, worker, and affected module tests.

## Rules

- Never delete installed package files, migrations, or generated registries.
- Never disable a module required by an enabled module, extension host, override, bootstrap, or provider.
- Preserve user-authored app modules and behavior unless explicitly included.
- Treat module metadata/source as read-only evidence and report uncertainty rather than guessing.
