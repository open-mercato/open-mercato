---
title: "When a task brief requires Playwright coverage, unit tests are not a substitute"
modules: ["events","search"]
areas: ["testing"]
topics: ["events","module-boundaries","testing"]
---

# When a task brief requires Playwright coverage, unit tests are not a substitute

**Context**: `packages/search/src/lib/merger.ts` received new Jest coverage, but the task brief and QA guides explicitly required module-local Playwright integration coverage.

**Problem**: The branch still failed review because the required coverage class was missing even though the low-level tests passed.

**Rule**: When a task brief, review artifact, or QA guide says Playwright or integration coverage is required, add or update a module-local `__integration__/TC-*.spec.ts` in the same change. Treat Jest or other low-level tests as complementary, not a replacement.

**Applies to**: HackOn implementation tasks and any change governed by `.ai/qa/AGENTS.md` or `.agents/skills/om-integration-tests/SKILL.md`.
