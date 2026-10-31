---
title: "Verify UI flows against a production build when dev-mode pages never hydrate"
modules: ["platform"]
areas: ["debugging","testing"]
topics: ["dev-runtime","node-runtime","runtime-startup"]
---

# Verify UI flows against a production build when dev-mode pages never hydrate

**Context**: Incident pages rendered their server markup under `yarn dev` / `yarn dev:app` but never became interactive on Node 24.14 — no console errors, no network fetches, and React fibers never attached to the DOM. The same commit worked when served through `yarn build:app` + `yarn start`.

**Problem**: A silent hydration failure looks identical to a feature bug. Without a second runtime to compare against, the obvious next step is bisecting feature code, which burns hours on a toolchain fault that the feature never caused.

**Rule**: When a page renders but nothing is interactive and the browser reports no errors, reproduce against a production build before touching feature code. If the production build works, suspect the Node/Turbopack toolchain — not the change under test.

**Applies to**: Dev-runtime debugging, UI QA of new backend pages, and any "the page loads but nothing happens" report.
