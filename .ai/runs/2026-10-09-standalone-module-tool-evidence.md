# Standalone module tool guidance evidence

## Scope and ownership

The self-authoritative workflow guide `.ai/guides/module-tool.md` is emitted from `packages/create-app/agentic/guides/module-tool.md`. The root router and architecture guide point to it. Before feature implementation, the existing module-scaffold skill directs agents with terminal access to run `npx create-mercato-module init <module_id>` for a new app module; existing modules skip initialization. Agents without process execution must report the capability gap. Publishing and linking details remain at the guide owner.

OMH-238 adds the focused read-only workflow case. The catalog contains 238 cases, including 49 writable cases. The derived source inventory retains 30 owners, 138 topics, 115 rendered links, eight baseline assets, and 136 dispositions. No sandbox image, module runtime, canonical example source, or public response contract changes.

Live validation uncovered three narrowly scoped compatibility issues, fixed with regression coverage: recreate the existing Arch merged-usr `/lib64 -> usr/lib` and `/sbin -> usr/bin` aliases inside the same isolation boundary; recalibrate five stale total-context ceilings against their already-declared files; and adapt Codex's wire schema without changing canonical schemas or validators. No new mounts, permissions, context paths, initial-context allowances, or production dependencies were added. The root instruction ceiling remains 12 KiB.

The Codex transport requires every object property, represents optional values with nullable fields, and omits unsupported wire `uniqueItems` while retaining canonical duplicate validation. Transport-only nulls normalize back to absent optional fields; genuinely nullable values, required invalid nulls, and unknown fields remain available to canonical validation. Its appended transport instruction prevents inventing unrequested optional content. These constraints follow the [official Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs). Both live checks below used the canonical routing-response contract; no live acceptance claim is made for the separate generated-code-review response schema.

## Failure-first proof and focused checks

The knowledge-change controller independently runs the four focused regression files against base `f0ef20936` plus only the test patch, and against the complete working head. All four base executions fail with exit 1; all four head executions pass with exit 0. The adjacent authored manifest and controller-result projection record SHA-256 evidence and actual exit codes. The unmodified validated controller result is retained outside Git. The explicitly identified sanitized projection replaces absolute Node executable paths with `node`; execution exit codes and stdout/stderr hashes are unchanged. It is not controller-authored execution input.

The regression files cover the module-tool workflow and routing, Arch aliases and rejection of unexpected alias targets, recursive Codex wire adaptation and canonical normalization, and exact declared-file context costs. Guidance initially failed with `missing supported module starter command`; alias coverage failed on the Arch layout; wire tests failed before the transport helpers existed; the context-cost test demonstrated that the previous 98,304-byte ceilings were insufficient. Only total ceilings for OMH-007, OMH-022, OMH-030, OMH-057, and OMH-064 changed, with at most 4 KiB spare over each declared read set.

The focused guidance, instruction-budget, surface-coverage, alias, wire-schema, and context-cost suite passes **31/31**. Existing evaluator planning, spec-routing, response-schema, correction, and routing-prompt checks pass **58/58**. Create-app TypeScript validation passes. The parent workflow completed the full ordered local core gate successfully, including package builds, generation, i18n checks, typecheck, unit tests, and application build.

## Packed scaffold and live validation

A coherent create-app build and npm tarball produce fresh classic, empty, CRM, and WMS apps with Codex instructions. The emitted module-tool guide, scaffold skill, evaluator, and isolation helper match their authoritative source bytes. The adjacent `2026-10-09-standalone-module-tool-validation-summary.json` records the tarball hash and a clearly identified derived summary of the packed and live results. OMH-238 passes deterministic validation in every preset. The complete classic catalog passes **238/238**, using actual extracted core, shared, and UI package tarballs rather than workspace symlinks. Other presets intentionally omit disabled module facts; their entire catalog is not claimed as passing.

Actual Codex 0.161.0 live checks, run sequentially in the isolated classic controller, pass:

- **OMH-238:** the new module workflow routes to architecture, reads the root and module-tool guide, and satisfies all six workflow decisions. Native result `2026-10-09T09-31-57-529Z-codex-OMH-238.json` reports pass and no violations.
- **OMH-216:** the representative spec-routing case passes with the existing `module-data` route and `direct` decision. Native result `2026-10-09T09-34-35-550Z-codex-OMH-216.json` reports pass and no violations after one supported correction. This exercises an actual spec classification alongside the absent optional-spec path in OMH-238.

The original ELF-loader and strict-schema preflight failures are resolved. The actual isolation probe passes with private user/network namespaces, isolated loopback, and zero payload capabilities. A concurrent diagnostic run contaminated a read-only snapshot with another case's result file; it was discarded and OMH-216 was rerun sequentially. No oracle or task instructions were tuned to that diagnostic failure.

This is the affected knowledge-contract lane, not a formal framework release-range refresh. The full per-release model suite was not run and is not claimed as certified. The harness's read/write-only tools do not execute `npx`; OMH-238 validates workflow routing. The standalone tool's separate release checks cover initialization, development linking, and a successful GitHub installation into a clean app. Its private npm fixture publication was blocked by registry E402, and live OIDC publication was not exercised; those lanes are not claimed as passing.
