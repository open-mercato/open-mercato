# Judge criteria

Open Mercato criteria for the `om-judge-agent-session` skill (`judge.criteria`, format: the skill's `references/criteria-format.md`). Rules come from the root `AGENTS.md`, nested package/module `AGENTS.md` files, and `BACKWARD_COMPATIBILITY.md`.

## Project guards

### Data scoping and authorization
- Every query on tenant-owned data is scoped by tenant and organization.
- RBAC/ACL features are checked server-side.
- Field encryption, mutation guards, and optimistic locking on user-editable entities are preserved.
- Inputs are validated (zod validators).

### Boundaries and ownership
- Module boundaries hold: no direct cross-module ORM relationships.
- Auto-discovery paths are respected.
- Generated files (`yarn generate` output) are never hand-edited.
- No writes to installed dependencies.

### Stable contract surfaces
- Frozen/stable contract IDs, routes, imports, events, widgets and injection spots, DI keys, ACL feature IDs, notifications, CLI commands, and deprecation bridges listed in `BACKWARD_COMPATIBILITY.md` stay intact.

### Route uniqueness
- No duplicate normalized API, backend page, or frontend page URLs; dynamic segments such as `[id]` and `[slug]` count as the same route shape.

### Canonical building blocks
- Canonical data/UI helpers (`makeCrudRoute`, `CrudForm`, `DataTable`, `apiCall`), i18n through the translation helpers, error/loading/empty states, and test coverage for changed behavior.

## Dependency provenance
- `node_modules/@open-mercato/*/src/**` — only explicit reads of exact, fact-linked source files that the case declares.

## Design system
- Monorepo: the local `om-ds-guardian` skill with `.ai/ds-rules.md`.
- Generated standalone app: that app's emitted `om-backend-ui-design` skill and its design-system references.
