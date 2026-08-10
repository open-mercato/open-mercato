# Standalone example runtime bootstrap fix

## Goal

Make the canonical example module start cleanly after it is explicitly enabled in a standalone app: AI-tool discovery must be idempotent and the activation guide must include the database migration step required before Todo routes are exercised.

Source doc: `.ai/specs/2026-07-31-standalone-canonical-example-module.md`

## Scope

- Make the AI tool registry loader once-per-process and concurrency-safe so repeated `/api/ai_assistant/tools` requests do not re-register the complete tool set.
- Keep intentional file-based AI tool replacements on the override path without emitting the generic duplicate-registration warning.
- Update both byte-identical example-module README copies to prescribe `yarn db:migrate` after generation.
- Add regression coverage for loader idempotence/concurrency, intentional overrides, and the emitted standalone activation instructions.
- Record the migration-activation lesson in the existing CLI/runtime-startup lesson.

## Non-goals

- Do not change the example module's entities, migration SQL, table names, or runtime registration default.
- Do not auto-apply migrations from `yarn generate` or application startup.
- Do not change AI agent/tool IDs, override precedence, ACL requirements, handlers, or public API response shapes.
- Do not modify the user's standalone checkout or apply its database migrations.

## Implementation Plan

### Phase 1: Runtime and activation fixes

- Make `loadAllModuleTools` share one in-flight/completed load and apply intentional tool replacements without duplicate warnings.
- Add focused AI-assistant regression tests for sequential and concurrent loader calls plus the override replacement path.
- Add the explicit migration command to the mirrored example activation guide and pin it in create-app delivery coverage.

### Phase 2: Knowledge and verification

- Update the matching migration/runtime-startup lesson and run the targeted package tests before the full configured validation gate.

## Risks

- A process-wide loader guard could hide a failed first load or prevent tests from resetting state; the implementation must clear its in-flight memo on rejection and expose only a test reset seam.
- Tool overrides must still update the registry's module ownership map and preserve the documented precedence order.
- The example tree is a byte-exact app/template mirror; both README copies must change together.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Runtime and activation fixes

- [ ] 1.1 Make `loadAllModuleTools` share one in-flight/completed load and apply intentional tool replacements without duplicate warnings.
- [ ] 1.2 Add focused AI-assistant regression tests for sequential and concurrent loader calls plus the override replacement path.
- [ ] 1.3 Add the explicit migration command to the mirrored example activation guide and pin it in create-app delivery coverage.

### Phase 2: Knowledge and verification

- [ ] 2.1 Update the matching migration/runtime-startup lesson and run the targeted package tests before the full configured validation gate.
