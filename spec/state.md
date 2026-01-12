# Monorepo Migration - State Tracker

This document tracks the progress of migrating Open Mercato to a publishable monorepo structure.

## Migration Overview

**Goal:** Transform the codebase into a Turborepo-based monorepo where each package is independently publishable to npm, with app-level generation scanning installed packages from `node_modules`.

**Target Structure:**
```
open-mercato/
├── apps/
│   ├── mercato/          # Next.js app (formerly root src/)
│   │   ├── .mercato/     # App-level generated files
│   │   └── src/
│   └── docs/             # Documentation site
├── packages/
│   ├── core/             # Publishable
│   ├── shared/           # Publishable
│   ├── ui/               # Publishable
│   ├── cli/              # Publishable
│   ├── client/           # Publishable (already)
│   ├── example/          # Publishable
│   ├── onboarding/       # Publishable
│   ├── vector/           # Publishable
│   ├── events/           # Publishable
│   ├── queue/            # Publishable
│   ├── cache/            # Publishable
│   └── content/          # Publishable
├── turbo.json
└── package.json
```

---

## Implementation Phases

| Phase | Document | Description | Status |
|-------|----------|-------------|--------|
| 0 | [phase-0.md](./phase-0.md) | Prerequisites - Package Generation Isolation | **Completed** |
| 1 | [phase-1.md](./phase-1.md) | Scripts to CLI Migration | **Completed** |
| 2 | [phase-2.md](./phase-2.md) | Turborepo Setup & Directory Restructure | Not Started |
| 3 | [phase-3.md](./phase-3.md) | Package Independence (Remove Path Mappings) | Not Started |
| 4 | [phase-4.md](./phase-4.md) | Package Publishability (DI Pattern) | Not Started |
| 5 | [phase-5.md](./phase-5.md) | App-Level Generation (.mercato) | Not Started |
| 6 | [phase-6.md](./phase-6.md) | Build Pipeline & Local Testing (Verdaccio) | Not Started |

---

## Related Specifications

These existing specs document foundational knowledge needed for the migration:

| Document | Relevance |
|----------|-----------|
| [generated-files.md](./generated-files.md) | How generation currently works |
| [publishable-packages.md](./publishable-packages.md) | 22 files need DI refactoring |
| [entity-fields-optimization.md](./entity-fields-optimization.md) | Can remove ~1,380 unused files |

---

## Checklist

### Phase 0: Prerequisites
- [x] Implement entity fields optimization (remove unused field files)
- [x] Implement DI registration pattern per publishable-packages.md
- [x] All packages have isolated `generated/` folders working
- [x] Tests pass with new DI pattern
- [x] Server-side bootstrap for package initialization
- [x] Client-side bootstrap for widget registrations
- [x] HMR-safe registration (handles Turbopack hot-reloading)

### Phase 1: Scripts to CLI Migration
- [x] Create package resolver (`packages/cli/src/lib/resolver.ts`)
- [x] Create generator modules (entity-ids, module-registry, module-entities, module-di, api-client)
- [x] Create `mercato generate` command
- [x] Create `mercato db` command group (generate, migrate, greenfield)
- [x] Update package.json scripts to use CLI commands
- [x] Clean up `scripts/` directory (keep only `typecheck.sh`)
- [x] Commands produce identical output to old scripts

### Phase 2: Turborepo & Structure
- [ ] Add turbo.json with task definitions
- [ ] Create `apps/` directory
- [ ] Move Next.js app to `apps/mercato/`
- [ ] Move docs to `apps/docs/`
- [ ] Update root package.json workspaces
- [ ] `yarn dev` works

### Phase 3: Package Independence
- [ ] Remove all tsconfig `paths` mappings
- [ ] Each package has proper `exports` field in package.json
- [ ] Packages reference each other via dependencies
- [ ] TypeScript resolves all imports correctly
- [ ] Build completes successfully

### Phase 4: Package Publishability
- [ ] All `@/generated/` imports removed from packages
- [ ] Packages export registration functions
- [ ] App calls registration functions at bootstrap
- [ ] Tests pass for isolated package usage

### Phase 5: App-Level Generation
- [ ] Generator scripts moved/adapted to scan `node_modules`
- [ ] `.mercato/` folder created with generated files
- [ ] App imports from `.mercato/` instead of root `generated/`
- [ ] Hot reload works with `.mercato/` generation
- [ ] Dev mode works end-to-end

### Phase 6: Build & Local Testing
- [ ] Each package has esbuild script producing dist/
- [ ] Verdaccio installed and configured
- [ ] Packages publish to local Verdaccio
- [ ] Test project can install from Verdaccio
- [ ] Imports work correctly from published packages

---

## Context Notes

*Add notes here as phases are completed to capture decisions, gotchas, and learnings.*

### Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-10 | Phase 0 completed - DI registration pattern implemented | All packages now use registration functions instead of `@/generated/` imports. Server-side bootstrap initializes packages, client-side bootstrap handles widget registrations. HMR-safe in development mode. |
| 2026-01-11 | Phase 1 completed - Scripts to CLI migration | All generation scripts migrated to CLI commands. Created PackageResolver abstraction for environment detection. Commands: `mercato generate [all|entity-ids|registry|entities|di|api-client]`, `mercato db [generate|migrate|greenfield]`. Cleaned up scripts/ directory (only typecheck.sh remains). |

### Known Issues

*Track any issues discovered during migration:*

1. Turbopack HMR resets module-level state in packages, requiring bootstrap to re-run registrations in development mode
2. Client-side widget injection requires separate bootstrap since server bootstrap doesn't hydrate to client
3. Middleware deprecation warning in Next.js 16 (middleware.ts → proxy.ts) - deferred to future update

### Rollback Points

*Document how to rollback if needed:*

- Before Phase 1: Git commit hash `______`
- Before Phase 2: Git commit hash `______`
- Before Phase 3: Git commit hash `______`
- Before Phase 4: Git commit hash `______`
- Before Phase 5: Git commit hash `______`
- Before Phase 6: Git commit hash `______`

---

## Verification Commands

After each phase, run these commands to verify stability:

```bash
# Basic health check
yarn install
yarn typecheck
yarn test

# Full verification
yarn build
yarn dev  # Manually test app works
```
