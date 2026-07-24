<!-- CODEX_ENFORCEMENT_RULES_START -->
## Codex enforcement

Read and route through the root `AGENTS.md`; it is the architecture and safety authority.

- After editing `src/modules/<id>/data/entities.ts`, run `yarn db:generate` as a schema-diff probe, review the scoped migration and module snapshot, and ask before `yarn db:migrate`.
- After changing `src/modules.ts` or an auto-discovered module file, run `yarn generate`.
- Never edit `.mercato/generated/**`, generated module facts, or `node_modules/**`.
- Before a significant feature, inspect `.ai/specs/` and follow the root task router.

<!-- CODEX_ENFORCEMENT_RULES_END -->
