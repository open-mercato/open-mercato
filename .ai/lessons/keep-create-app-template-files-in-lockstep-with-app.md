---
title: "Keep create-app template files in lockstep with app shell/layout changes"
modules: ["create_app","example","ui"]
areas: ["architecture","backend-ui","testing"]
topics: ["template-sync","ui-components"]
---

# Keep create-app template files in lockstep with app shell/layout changes

**Context**: Core app layout behavior was updated in `apps/mercato/src/app/(backend)/backend/layout.tsx`, but equivalent files in `packages/create-app/template/src/app/` were not updated in the same change.

**Problem**: Newly scaffolded apps diverged from monorepo defaults (missing newer navigation/profile/settings wiring and behavior fixes), causing inconsistent UX and harder debugging.

**Rule**: Any change to shared bootstrap/layout shell behavior in `apps/mercato/src/app/**` must include a sync review and required updates in matching `packages/create-app/template/src/app/**` and dependent template components.

**Applies to**: Root layout, backend layout, global providers, header/sidebar wiring, related template-only wrapper components, and mirrored example integration tests.

**CI correction (2026-10-27)**: Locator repairs in `apps/mercato/src/modules/example/__integration__/` must also reach `packages/create-app/template/src/modules/example/__integration__/`. Run the existing template example parity test before publishing; a passing Playwright discovery check alone does not verify the scaffold copy.
