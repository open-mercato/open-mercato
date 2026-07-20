---
name: om-ux-copy
description: "Run a microcopy pass over every text-bearing compose prop of an Open Mercato *.mockup.json screen and emit ready i18n keys with en/pl/es/de values as a companion <slug>.copy.json file. Use when asked to 'write the copy for this mockup', 'polish the microcopy', 'prepare the i18n keys', 'translate the mockup texts', or after om-ux-heuristics finishes a critique pass. Triggers on 'microcopy', 'copy pass', 'copy.json', 'mockup i18n', 'teksty makiety'. The renderer prefers copy-file values, so the reviewed screen shows the finished copy live."
---

# UX Copy — Four-Locale Microcopy for Mockup Documents

You write the product microcopy for a mockup (`*.mockup.json`, spec `.ai/specs/2026-07-05-ds-live-mockup-composer.md`) as a companion copy file, applying the content-design rules of the **om-ux-product-design** decision system (`.ai/skills/om-ux-product-design/SKILL.md`). The mockup renderer prefers copy-file values for the active locale, so the reviewer sees the finished copy in the live render; on implementation the keys migrate into module `i18n/` files.

## I/O contract (composable pipeline stage)

- **Consumes:** one `*.mockup.json` document.
- **Produces:** `<slug>.copy.json` BESIDE the mockup file (`.ai/mockups/<slug>.copy.json` for spec-stage documents). You never edit the mockup document itself.
- **Chain position:** flows → compose → heuristics → **copy** → iterate.

## The copy file shape

Schema: `copyFileSchema` in `packages/core/src/modules/design_system/mockups/copy.ts`.

```jsonc
{
  "version": 1,
  "keys": {
    "mockup.<slug>.<blockId>.<propPath>": {
      "en": "…", "pl": "…", "es": "…", "de": "…"   // all four, always
    }
  }
}
```

## Rules

1. **Deterministic keys.** `mockup.<slug>.<blockId>.<propPath>` with nested prop paths dot-joined (`kpi-active-people.trend.direction`). Derive the exact key set with `expectedCopyKeys(document)` from `mockups/copy.ts` — never invent keys, never skip one. Re-runs must produce the same keys so diffs stay stable (unit-tested against the golden fixture).
2. **Cover every text-bearing prop.** A text-bearing prop is every string-valued compose prop, nested ones included (`collectTextProps`). The gate test fails a copy file that misses one.
3. **Technical strings pass through unchanged.** Enum-constrained values (`trend.direction: "up"`), currency symbols, and prefixes keep the identical value in all four locales — translating them would break the entry's `composePropsSchema` or the meaning. When in doubt, check the entry's schema in `gallery/entries/`.
4. **en is the base voice.** Concise, sentence case, no exclamation marks, no filler. pl/es/de are real translations in the product voice — never machine-gloss placeholders, never the en string copied over (except rule 3 technical strings).
5. **Fictional data stays fictional** in every locale — no real names, no real companies.
6. **On implementation** the keys move into the owning module's `i18n/{en,pl,es,de}.json` and the copy file is retired with the mockup; note this in the handoff.

## Content-design rules (apply to every value, in every locale)

From the umbrella system (source: GOV.UK content design, https://www.gov.uk/guidance/content-design):

1. **The heading says what the user can do** on the screen or in the section — not what the system is.
2. **Buttons name the action.** Never a bare "OK", "Next", or "Send" when the action can be named — "Save changes", "Send invoice". (Bare verbs on action blocks are also flagged mechanically by `om-ux-heuristics` — your copy pass is where they get fixed.)
3. **Messages never blame the user.** Errors state what is wrong AND how to fix it, in that order of usefulness, without "you failed/invalid input" framing.
4. **Instruction before the moment of need** — format hints and requirements appear before the user acts, not in the error afterwards.
5. **The most important information first** — front-load the key fact in headings, notices, and empty states.
6. **User language** — understandable without domain or system knowledge; no internal jargon, table names, or error codes as copy.
7. **Consistency across screens** — one name per concept, one verb per action, everywhere; when the mockup conflicts with shipped screens, flag it in the report rather than inventing a third variant.

### Microcopy anti-patterns — never ship these

Placeholder text doing a label's job; error copy without the fix; vague action labels (OK/Next/Send/Submit alone); disabled-state copy that does not say what is missing; success states with no copy at all (silent success); copy that hides costs, limits, or consequences.

## Workflow

1. Load the document (`GET /api/design_system/mockups/<slug>` or the file) and list `collectTextProps(document)`.
2. Write or rewrite `<slug>.copy.json` covering exactly that key set, four locales per key.
3. Validate: `yarn workspace @open-mercato/core test --testPathPatterns design_system` — the committed copy file is schema-checked and coverage-checked.
4. Preview at `/backend/design-system/mockups/<slug>` — the stage renders your copy for the active locale; switch locales to proof all four.
5. Report the keys you changed and any prop you passed through under rule 3.

Golden reference: `.ai/mockups/customers-people-list.copy.json`.
