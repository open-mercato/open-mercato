# Calendar Toolbar Hydration Error

## Goal

Prevent the CRM calendar toolbar from producing byte-different server and client date-range labels when their `Intl` implementations use different invisible spacing characters.

Source doc: `.ai/specs/2026-06-11-crm-calendar.md`

## Scope

- Add regression coverage for locale-aware calendar labels whose visible text is identical but whose `Intl` output contains environment-dependent Unicode spacing.
- Canonicalize invisible spacing in the shared calendar date/time formatting helper while preserving localized month names, clock formats, visible punctuation, and the existing fallback path.
- Verify the focused customers-calendar tests and the repository's configured validation gate.

## Non-goals

- Do not change locale detection, timezone behavior, calendar range calculations, or the toolbar component contract.
- Do not redesign the visible date/time formats or touch unrelated calendar surfaces.
- Do not add dependencies, API changes, schema changes, or migrations.

## Implementation Plan

### Phase 1: Deterministic localized labels

1. Add regression coverage that rejects hydration-unstable Unicode spacing in date and time labels.
2. Canonicalize invisible `Intl` spacing without changing the visible localized output or fallback behavior.

### Phase 2: Verification

1. Run focused calendar formatter tests and the complete configured validation gate, then review the final diff for compatibility and scope.

## Risks

- Unicode normalization could accidentally alter meaningful visible punctuation. Mitigation: normalize only known space variants and keep locale-specific words, ordering, punctuation, and hour cycles untouched.
- Different runtimes may vary beyond whitespace. The attached React diff shows visually identical range text, so this run deliberately addresses the proven invisible-character mismatch and leaves broader format redesign out of scope.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Deterministic localized labels

- [ ] 1.1 Add regression coverage that rejects hydration-unstable Unicode spacing in date and time labels.
- [ ] 1.2 Canonicalize invisible `Intl` spacing without changing the visible localized output or fallback behavior.

### Phase 2: Verification

- [ ] 2.1 Run focused calendar formatter tests and the complete configured validation gate, then review the final diff for compatibility and scope.
