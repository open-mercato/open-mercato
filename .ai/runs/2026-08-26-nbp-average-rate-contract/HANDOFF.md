# Handoff — NBP average-rate contract

## Current step

1.1 — contracts, persistence, migration, and fetch selection.

## Context

Core implementation was explicitly confirmed. The source spec is currently an untracked user-provided file outside this worktree; include it in the final PR with implementation status once the code work is complete.

## Next actions

1. Implement the provider contract and `externalReference` persistence.
2. Generate the scoped migration and update its snapshot.
3. Add default/explicit provider selection and duplicate-batch validation.
