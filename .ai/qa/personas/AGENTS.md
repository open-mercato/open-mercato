# QA Personas — Authoring Rules

Persona definitions consumed by the `om-ux-walkthrough` skill (`.ai/skills/om-ux-walkthrough/SKILL.md`).
A persona is **content, not code**: one markdown file per persona, YAML frontmatter plus a prose
behavior brief. Personas are reviewed like code (PRs against this directory) and versioned in git —
every walkthrough run record pins the persona file's git blob hash so a compare across runs knows
whether the persona itself changed.

## Always

- Give every persona the full frontmatter schema below; a persona failing validation aborts the
  walkthrough before the environment boots.
- Source `vocabulary` from **real user language** — support tickets, sales calls, onboarding
  sessions — never from the product's own labels. A persona that speaks the house vocabulary
  masks exactly the mislabels the walkthrough exists to find.
- Keep the prose behavior brief at 10–20 lines: how this person scans a page (menu first?
  search first?), what makes them give up, what they would mutter at a dead end.
- End the prose body with the standard synthetic-persona footer (see below).
- Validate before committing: `node .ai/skills/om-ux-walkthrough/scripts/validate-persona.mjs --all`

## Never

- Never present a persona as a real person or as the output of real user research. Personas are
  **synthetic**: authored hypotheses about a user archetype. This rule is absolute — it holds in
  persona files, in walkthrough reports, and in any discussion that cites them.
- Never name a persona after a real customer, colleague, or research participant.
- Never encode the product's internal names (module ids, route paths, component names) in
  `vocabulary` or the prose brief — that breaches the walkthrough's knowledge firewall by proxy.
- Never delete or rewrite a persona another team relies on without a PR discussion; run records
  reference personas by id + blob hash, and silent rewrites corrupt cross-run comparisons.

## Frontmatter schema

```yaml
---
id: first-contact-accountant        # kebab-case, unique, matches the filename, doubles as --persona value
name: "Maria, staff accountant"     # archetype label — never a real person
age_band: "45-55"
tech_fluency: low | medium | high   # calibrates candidate-action patience and jargon tolerance
domain_knowledge: "Accounting terms yes; this system: never seen it before."
goal_template: "Book an incoming invoice for {client} and send confirmation."   # optional default goal
patience_budget: 25                 # max navigator steps per run before abandoning
vocabulary:                          # quirks steering label matching — externally sourced
  - "Says 'book an invoice', never 'create a sales document'."
  - "Expects 'Clients', not 'Companies' or 'Accounts'."
---
Prose behavior brief (10–20 lines).
```

Field rules:

- `id` — kebab-case, unique across this directory, MUST equal the filename without `.md`.
- `tech_fluency` — exactly one of `low`, `medium`, `high`.
- `patience_budget` — positive integer; this is the persona's own tolerance. A separate global
  hard cap (default 40 steps/run) bounds cost regardless of persona, so budgets above 40 are
  effectively truncated (the validator warns).
- `goal_template` — optional; used when the invoker passes no `--goal`.
- `vocabulary` — non-empty list of short behavioral statements about the words this archetype
  uses and expects.

## Naming

- Filename: `<id>.md`, e.g. `first-contact-accountant.md`.
- Ids describe the archetype's relationship to the system (`first-contact-…`, `daily-…`,
  `new-tenant-…`), not a demographic.

## Review expectations

A persona PR is approvable when:

1. Frontmatter validates (`validate-persona.mjs`).
2. Vocabulary entries cite or plausibly reflect externally observed user language (say where it
   came from in the PR description).
3. The persona produces a **distinguishable signal** from the existing library — a new persona
   that would walk every flow the same way as an existing one adds nothing.
4. The synthetic-persona footer is present.

## Standard synthetic-persona footer

Every persona prose body MUST end with this line, verbatim:

> Synthetic persona — an authored hypothesis about a user archetype, not a record of any real
> person and not a substitute for real user research.

## Seed personas

| Id | Archetype | Signal it exercises |
|----|-----------|---------------------|
| `first-contact-accountant` | Backoffice domain expert, first contact with the system | First-run discoverability — the signal quarterly research is slowest to deliver |
| `daily-ops-admin` | Backoffice operator who knows the current IA by daily use | Efficiency regressions for existing users |
| `new-tenant-admin` | Tenant admin on day one, setting the workspace up | Setup/configuration discoverability across module boundaries |
