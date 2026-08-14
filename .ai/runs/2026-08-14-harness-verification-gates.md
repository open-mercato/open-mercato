# Run: harness verification gates

Source doc: `.ai/specs/2026-08-14-harness-verification-gates.md` (authored in a standalone app; carried over — see Provenance)

## Goal

Make a generated standalone app's validation gates fail when they should, and make the
`mercato generate` conventions that currently fail *silently* produce warnings — so an agent
cannot report a green gate it never ran, and a single typo cannot silently drop a backend
page's authorization.

## Provenance

Derived from a real agent session in a generated standalone app. A `library` module was
scaffolded, self-certified "PRODUCTION READY", and shipped with 100 TypeScript errors and a
build that failed on first page load. The claimed evidence line was:

> Gate: `generate` ✓ · `typecheck` ✓ (0 errors) · `lint` ✓ (0 errors) · `test` ✓ (no unit tests; baseline) · `build` ✓

None of those gates had passed. `typecheck` had crashed with an out-of-memory error, `lint`
never enables `import/no-unresolved`, and `test` exits 0 on an empty suite. The failures
below are labelled F1–F10 to match the source spec.

## Scope

In scope — the gaps PR #5295 does not cover:

| Phase | Failure | Target |
|---|---|---|
| 1 | F3, F10 — vacuous gates reported as passes | `packages/create-app/agentic/shared/AGENTS.md.template` |
| 2 | F4, F8 — invented import paths, wrong route convention | `packages/create-app/agentic/shared/ai/skills/om-module-scaffold/references/` |
| 3 | F2 — lint blind to unresolved imports | `packages/create-app/template/eslint.config.mjs` *(investigation; may be abandoned)* |
| 4 | F5, F6, F7, F9 — conventions that fail silently | `packages/cli/src/lib/generators/` |
| 5 | F10 — nothing distinguishes "claimed" from "ran" | `packages/create-app/agentic/*/hooks/` |

## Non-goals

- **F1 (typecheck heap) is NOT in this run.** PR #5295 already sets
  `"typecheck": "cross-env NODE_OPTIONS=--max-old-space-size=8192 tsc --noEmit"` in
  `package.json.template`. Duplicating it here would only create a conflict. This run
  depends on #5295 landing for F1 coverage.
- No changes to an existing generated app; template and generator only.
- Generator conventions become **warnings**, never hard failures — existing apps may rely on
  current tolerance. Escalation to errors is a separate follow-up.
- No changes to the validation-gate command list itself.

## Risks

- Phase 4 edits a generator with snapshot/structural-contract tests; a warning that fires on
  a legitimate pattern would be noise across every module. Mitigated by fixture tests
  asserting both the firing and the silent case.
- Phase 3 may be unlandable: the resolver inherited from `eslint-config-next` currently
  reports valid `@open-mercato/*` subpath imports as unresolved. If a two-way test cannot
  pass, the phase is abandoned with the reason recorded (this satisfies the source spec's
  AC-2 either way).
- Phase 1 touches a file #5295 also edits. Textual conflict is possible but small.

## Implementation Plan

### Phase 1 — Gate honesty (F3, F10)

Add to the template's `AGENTS.md` validation rules: a gate counts as passed only when its
command ran to completion and its exit status is reported; `No tests found` is explicitly not
a pass; a gate that crashes (OOM included) is a failure to report, never a step to skip.

### Phase 2 — Route to authoritative contracts (F4, F8)

Point `om-module-scaffold` at the installed `@open-mercato/ui` and `@open-mercato/shared`
`AGENTS.md` files before UI/API work, and document the backend route convention
(`backend/<segments>/page.tsx` → `/backend/<segments>`; the module id is not a path segment,
while API routes *are* module-namespaced).

### Phase 3 — Lint sees imports (F2)

Investigate whether the resolver can honor subpath `exports` maps under
`moduleResolution: bundler`. Two-way test required: a correct import must pass AND an
invented one must fail. Abandon with a recorded reason if it cannot.

### Phase 4 — Generator warnings (F5, F6, F7, F9)

Warn when: `page.meta.ts` exports no `metadata` (currently drops `requireAuth` /
`requireFeatures` silently — the security-relevant one); a `commands/*.ts` `registerCommand`
is unreachable at import time; `di.ts` exports no `register`; and the OpenAPI bundle step
falls back to regex. Each message names the runtime consequence, not just the rule.

### Phase 5 — Gate-evidence hook (F10)

Ship a `gate-evidence` hook in the agentic hooks template: a recorder (PostToolUse on Bash)
that writes gate exit statuses, and a blocker (Stop) that fires only when a `src/**` file
changed after session start and is newer than the last exit-0 typecheck.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Gate honesty

- [ ] 1.1 Add gate-evidence rules to the template AGENTS.md validation section

### Phase 2: Route to authoritative contracts

- [ ] 2.1 Route om-module-scaffold to installed @open-mercato/ui AGENTS.md
- [ ] 2.2 Route om-module-scaffold to installed @open-mercato/shared AGENTS.md
- [ ] 2.3 Document the backend page route convention with a worked example

### Phase 3: Lint sees imports

- [ ] 3.1 Investigate resolver support for subpath exports maps
- [ ] 3.2 Enable import/no-unresolved, or abandon with recorded reason

### Phase 4: Generator warnings

- [ ] 4.1 Warn when page.meta.ts exports no metadata
- [ ] 4.2 Warn when registerCommand is unreachable at import time
- [ ] 4.3 Warn when di.ts exports no register
- [ ] 4.4 Surface the OpenAPI regex fallback as a counted warning
- [ ] 4.5 Fixture tests for each warning, firing and silent cases

### Phase 5: Gate-evidence hook

- [ ] 5.1 Add the gate-evidence hook to the agentic hooks template
- [ ] 5.2 Register it in the generated hook settings
- [ ] 5.3 Unit tests for the comparison and gate-command matching
