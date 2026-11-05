---
title: "Keep executable integration tests module-local"
modules: ["platform"]
areas: ["testing","module-data"]
topics: ["module-boundaries","package-runtime","testing"]
---

# Keep executable integration tests module-local

**Context**: Legacy Playwright specs were still stored under `.ai/qa/tests/`, including AI-tool and UX regression specs that belonged to concrete modules.

**Problem**: Tests under `.ai` are detached from the module that owns the behavior, so affected-test discovery, module gating, package ownership, and review context all become weaker.

**Rule**: Do not add executable `.spec.ts` files under `.ai/qa/tests/`. Place Playwright integration specs under the owning module's `__integration__/` directory, and keep `.ai/qa/tests/` reserved for shared Playwright configuration only.

**Applies to**: All Playwright integration tests, QA scenario conversions, and any task using `.agents/skills/om-integration-tests/SKILL.md`.
