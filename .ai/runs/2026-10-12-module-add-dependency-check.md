# Module Add Dependency Check

Source doc: `.ai/specs/implemented/SPEC-065-2026-03-14-official-modules-cli-install-and-eject.md`

## Goal

Prevent `mercato module add` and `mercato module enable` from registering a module when its descriptor declares required modules that are not enabled, and tell the user exactly what must be enabled first.

## Scope

- Read the selected module's static `metadata.requires` declaration as part of package discovery.
- Compare declared dependencies with the app's currently enabled module ids before registration or source ejection.
- Return actionable CLI guidance and keep `src/modules.ts` unchanged when dependencies are missing.
- Add focused unit coverage and update the module-add documentation and source specification.

## Non-goals

- Automatically enable dependencies or resolve their package providers.
- Implement transitive dependency closure, multi-module batch enablement, or module sets.
- Roll back a package-manager install completed before package metadata can be inspected.

## Implementation Plan

### Phase 1: Dependency-aware registration

1. Extend installed-module metadata discovery to retain static `requires` entries.
2. Validate required module ids against the app configuration before registration and ejection side effects.

### Phase 2: Coverage and guidance

1. Add regression tests and document the fail-closed dependency behavior.

## Risks

- Conditional registrations must use the same resolved enabled-module view as the generator so the preflight does not disagree with normal generation.
- Descriptor parsing remains limited to statically declared string arrays; dynamic metadata stays subject to the generator's final dependency gate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Dependency-aware registration

- [x] 1.1 Extend installed-module metadata discovery to retain static `requires` entries. — 03c0626dc
- [x] 1.2 Validate required module ids against the app configuration before registration and ejection side effects. — 03c0626dc

### Phase 2: Coverage and guidance

- [ ] 2.1 Add regression tests and document the fail-closed dependency behavior.
