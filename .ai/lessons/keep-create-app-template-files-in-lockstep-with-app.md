---
title: "Keep create-app template files in lockstep with app shell/layout changes"
modules: ["create_app","ui","example"]
areas: ["architecture","backend-ui","testing"]
topics: ["template-sync","ui-components","testing"]
---

# Keep create-app template files in lockstep with app shell/layout changes

**Context**: Core app layout behavior was updated in `apps/mercato/src/app/(backend)/backend/layout.tsx`, but equivalent files in `packages/create-app/template/src/app/` were not updated in the same change.

**Problem**: Newly scaffolded apps diverged from monorepo defaults (missing newer navigation/profile/settings wiring and behavior fixes), causing inconsistent UX and harder debugging.

**Context**: A Todo integration-test correction also failed the canonical example-module parity test when only the app copy changed. Template tests are excluded from scaffold output, but their source still must match byte-for-byte.

**Rule**: Any change to shared bootstrap/layout shell behavior in `apps/mercato/src/app/**` must include a sync review and required updates in matching `packages/create-app/template/src/app/**` and dependent template components. The canonical example module includes its tests in that mirror: after changing any file there, run `yarn template:sync:fix`, `yarn template:sync`, and the focused `template-example-module-parity.test.ts` before publishing.

**Applies to**: Root layout, backend layout, global providers, header/sidebar wiring, and related template-only wrapper components, and every file in the canonical example module, including integration and unit tests.
