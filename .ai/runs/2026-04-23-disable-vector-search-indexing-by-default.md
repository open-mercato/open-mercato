## Overview

- Goal: Disable vector search auto-indexing by default in shipped env examples and document the explicit opt-in path for enabling it.
- Affected modules/packages: `packages/search`, `packages/core`, `apps/mercato`, `packages/create-app/template`, `apps/docs`.
- Smallest safe scope: add a preferred `OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING` environment flag with backward-compatible support for the legacy flag, update env examples to default auto-indexing off, and align all env-focused docs.
- Non-goals: changing search strategy behavior, removing the legacy env flag, changing embedding provider support, or modifying search UI defaults.

## Risks

- Env-name drift: docs and runtime could diverge if the new alias is not wired everywhere that reads or reports the flag.
- Backward compatibility: the legacy `DISABLE_VECTOR_SEARCH_AUTOINDEXING` flag must keep working for existing deployments.
- Docs coverage: env-focused installation/customization pages must all describe the same opt-in steps or operators will get conflicting guidance.

## Implementation Plan

### Phase 1: Plan and BC-safe env support

1. Add the run plan on the task branch.
2. Introduce `OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING` as the preferred env name while preserving `DISABLE_VECTOR_SEARCH_AUTOINDEXING` as a supported legacy alias in runtime/config surfaces.

### Phase 2: Default-off examples and docs

1. Update shipped `.env.example` files so vector auto-indexing is disabled by default and the enable path is explicit.
2. Update env-focused docs pages to explain that vector search remains available when an embedding provider is configured, but auto-indexing is opt-in via `OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING=false` or by removing the disable flag.

### Phase 3: Validation and PR delivery

1. Run docs-focused validation and re-read the diff for scope/BC issues.
2. Commit progress updates, push the branch, open the PR, label it, and post the required summary.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Plan and BC-safe env support

- [ ] 1.1 Add the run plan on the task branch
- [ ] 1.2 Introduce `OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING` as the preferred env name while preserving `DISABLE_VECTOR_SEARCH_AUTOINDEXING` as a supported legacy alias in runtime/config surfaces

### Phase 2: Default-off examples and docs

- [ ] 2.1 Update shipped `.env.example` files so vector auto-indexing is disabled by default and the enable path is explicit
- [ ] 2.2 Update env-focused docs pages to explain that vector search remains available when an embedding provider is configured, but auto-indexing is opt-in via `OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING=false` or by removing the disable flag

### Phase 3: Validation and PR delivery

- [ ] 3.1 Run docs-focused validation and re-read the diff for scope/BC issues
- [ ] 3.2 Commit progress updates, push the branch, open the PR, label it, and post the required summary
