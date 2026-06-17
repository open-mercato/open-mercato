# Execution plan — add HIRING.md

**Slug:** add-hiring-md
**Date:** 2026-06-17
**Branch:** feat/add-hiring-md

## Goal

Add a top-level `HIRING.md` describing the "Senior AI Engineering / Forward Deployed Engineer" role on the Open Mercato Core Team, with an Apply section that routes applications to `info@openmercato.com` and includes a GDPR-compliant data-processing notice and consent statement.

## Scope

- Add a single new docs file `HIRING.md` at the repo root.
- Verbatim role content supplied by the user, lightly cleaned for Markdown formatting (no stray double-spaces, proper bullet nesting).
- Apply section: require LinkedIn profile, CV, and GitHub links sent to `info@openmercato.com`, plus an explicit GDPR consent line and a "How we process your data" notice (controller, purpose, legal basis, retention, rights, contact).

## Non-goals

- No code changes, no module changes, no generated files.
- No changes to CI, README, or any existing doc.
- No new dependencies.

## Risks

- Docs-only; minimal risk. GDPR copy is informational boilerplate aligned to GDPR Arts. 6(1)(a), 13, 15–21; it is not legal advice and uses the public `info@openmercato.com` contact. No contract surface touched.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Author HIRING.md

- [x] 1.1 Write HIRING.md role content (formatted from the brief) — e801665ae
- [x] 1.2 Add Apply section with info@openmercato.com routing + GDPR consent & processing notice — e801665ae

### Phase 2: Validate & ship

- [x] 2.1 Re-read diff, lint markdown, open PR against develop with labels — (this commit)
