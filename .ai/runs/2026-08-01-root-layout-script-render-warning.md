# Root Layout Script Render Warning

## Goal

Remove the React development-console error caused by rendering the theme initializer as a raw `<script>` while preserving the initializer's pre-hydration behavior in both the monorepo app and generated standalone apps.

## Scope

- Add focused regression coverage for the root layout's theme initializer.
- Replace the raw script element with Next.js's supported `Script` component using the `beforeInteractive` strategy.
- Keep `apps/mercato/src/app/layout.tsx` and `packages/create-app/template/src/app/layout.tsx` behaviorally aligned.
- Run the configured validation gate and the authoritative PR review/autofix pass.

## Non-goals

- Do not change theme selection semantics, storage keys, or dark-mode styling.
- Do not refactor `AppProviders` or other app-shell responsibilities.
- Do not change dependencies, routes, public contracts, or generated artifacts.

## Implementation Plan

### Phase 1: Regression coverage

1. Add a layout regression assertion that requires the theme initializer to use Next.js `Script` with stable identity and pre-interactive execution.

### Phase 2: Minimal repair

1. Migrate the mirrored root layouts from a raw script element to `next/script` without changing the initializer body.

### Phase 3: Verification and delivery

1. Run targeted coverage, the full configured validation gate, and the authoritative PR review/autofix workflow; publish the results and UI evidence on the PR.

## Risks

- Changing script placement or strategy could allow a light-theme flash before hydration; the fix therefore retains `beforeInteractive` execution and the existing initializer body.
- Updating only the monorepo app would leave newly scaffolded apps broken; both layout copies are changed and reviewed together.
- No matching feature specification exists because this is a narrow regression fix rather than a new capability.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Regression coverage

- [ ] 1.1 Add a layout regression assertion that requires the theme initializer to use Next.js `Script` with stable identity and pre-interactive execution.

### Phase 2: Minimal repair

- [ ] 2.1 Migrate the mirrored root layouts from a raw script element to `next/script` without changing the initializer body.

### Phase 3: Verification and delivery

- [ ] 3.1 Run targeted coverage, the full configured validation gate, and the authoritative PR review/autofix workflow; publish the results and UI evidence on the PR.
