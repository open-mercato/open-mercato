# Log command-interceptor registry import failures (#4491)

## Goal

Make the CLI/worker bootstrap loader (`packages/shared/src/lib/bootstrap/dynamicLoader.ts`) emit a
clear error when an optional generated registry — above all
`command-interceptors.generated.ts` — exists but fails to compile or import, instead of silently
degrading to an empty entry list. The compatibility fallback for a genuinely absent file must stay
silent, so a fresh app without the generated file keeps booting exactly as it does today.

## Scope

- `packages/shared/src/lib/bootstrap/dynamicLoader.ts` — distinguish "generated file absent" from
  "generated file present but broken", log the latter through the shared logging facade, keep the
  empty-array fallback in both cases.
- `packages/shared/src/lib/bootstrap/__tests__/dynamicLoader.commandInterceptors.test.ts` —
  regression coverage that separates the expected-missing case from the unexpected-failure case.

### Non-goals

- No change to the failure mode itself: a broken registry still falls back to an empty list rather
  than aborting bootstrap. Turning this into a hard failure is a behavior change the issue does not
  ask for and would risk breaking existing deployments.
- No changes to `factory.ts`, the command interceptor registry, or the Next.js runtime loader.
- No changes to the required generated files (`modules.cli`, `entities`, `di`, `entities.ids`) —
  those already throw.

## Implementation Plan

### Phase 1: Distinguish and log registry load failures

Introduce a `GeneratedFileNotFoundError` thrown by `compileAndImport` when the `.ts` source is
absent, plus a `loadOptionalGeneratedModule` helper that returns the fallback for that error and
logs `logger.error` with the file path and the underlying error for anything else. Route the four
optional registries (`search`, `command-loaders`, `command-interceptors`, `workflows`) through it so
the same blindness cannot recur for any of them.

### Phase 2: Regression coverage

Extend the existing bootstrap test so it asserts three distinct behaviors: entries load when the
registry is valid; an absent file falls back quietly; a present-but-unimportable file falls back
*and* logs an error naming the file.

### Phase 3: Validation gate

Run the configured `validation.commands` gate and fix anything it surfaces.

## Risks

- Low. The change is additive diagnostics inside one loader; the returned `BootstrapData` shape and
  the fallback values are unchanged.
- The logger is imported at bootstrap-loader scope; it is already used elsewhere in
  `packages/shared/src/lib` (for example `encryption/entityIds.ts`, which this same file imports),
  so no new dependency direction is introduced.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Distinguish and log registry load failures

- [ ] 1.1 Add `GeneratedFileNotFoundError` and the `loadOptionalGeneratedModule` helper
- [ ] 1.2 Route the optional generated registries through the helper

### Phase 2: Regression coverage

- [ ] 2.1 Cover missing-file fallback vs. logged compile/import failure

### Phase 3: Validation gate

- [ ] 3.1 Run the full validation gate and resolve findings
