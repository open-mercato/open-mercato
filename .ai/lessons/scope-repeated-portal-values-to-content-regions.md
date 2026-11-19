---
title: "Scope repeated portal values to content regions"
modules: ["portal"]
areas: ["backend-ui","integration","testing"]
topics: ["accessibility","testing"]
---

# Scope repeated portal values to content regions

**Evidence**: PR #8582 CI run 43853912843 failed the responsive profile regression before its viewport assertions: the same customer email appeared in the sidebar and profile card, so a page-wide exact-text locator violated Playwright strict mode.

**Rule**: Scope repeated account values to their owning accessible content region, such as `getByRole('main')`, and assert a unique match before interacting or measuring layout. Do not hide ambiguity with `first()`, relax strictness, or increase timeouts. Run the actual browser regression; source checks cannot verify the rendered shell.

**Applies to**: Portal profile and dashboard tests where shared navigation repeats record fields.
