---
name: om-ux-flows
description: "Turn an Open Mercato user story (or story set) into a validated flow outline (*.flow.json): which screens exist, what belongs on each, task order, required data, and the state-matrix rows to cover. Use when asked to 'plan the flow', 'break this story into screens', 'prepare a flow outline', 'generate a draft mockup from a story', or as the first stage of the flows → compose → heuristics → copy chain. Triggers on 'flow outline', 'flow.json', 'user story to screens', 'story to mockup', 'draft generation', 'zaplanuj przepływ'. The only UX pipeline stage that reads prose; everything downstream reads the structured artifact."
---

# UX Flows — User Story to Flow Outline

You turn a user story, feature description, or spec section into a **flow outline**: a zod-validated `*.flow.json` artifact (schema `packages/core/src/modules/design_system/mockups/flow.ts`), not prose. You are the ONLY stage of the UX pipeline that reads prose — `om-ds-mockup` consumes your outline to generate draft mockups, `om-ux-heuristics` critiques the result, `om-ux-copy` finishes the words. Spec: `.ai/specs/2026-07-05-ds-live-mockup-composer.md`, Phase 3.

This skill executes steps 1-2 of the `om-ux-product-design` process (define the problem, map the critical path) and freezes the result as data. Its evidence rules apply in full: missing information becomes an explicit `[ASSUMPTION]` recorded in the outline's descriptions or reported to the requester — never a silently filled gap.

## The artifact

`.ai/mockups/<name>.flow.json`, validated by `flowOutline`:

```jsonc
{
  "version": 1,
  "source": "US-CRM-301",              // user story id or spec path — the traceability root
  "entity": "person",                   // optional promotion hint, carried into drafts
  "module": "customers",                // optional promotion hint
  "screens": [
    {
      "slug": "customers-quick-add",   // becomes the mockup slug
      "purpose": "Quick-add a person", // one line, user-task language
      "order": 1,                       // task order along the critical path
      "states": ["initial", "validation-error", "success"],  // state-matrix rows to cover
      "intents": [
        {
          "kind": "form",              // list | form | detail | dashboard | action | navigation | feedback
          "description": "Capture the new person with the minimum viable fields",
          "userStory": "US-CRM-301",   // link back to the story this intent serves
          "fields": [                   // required data, scaffold-DSL vocabulary
            { "name": "firstName", "type": "text", "required": true },
            { "name": "segment", "type": "select", "options": ["retail", "wholesale"] }
          ]
        }
      ]
    }
  ],
  "transitions": [
    { "from": "customers-quick-add", "to": "customers-people-list", "trigger": "save" }
  ]
}
```

Rules the schema enforces (an invalid outline fails `yarn ds:mockups:draft` immediately):

- Screen slugs `^[a-z0-9-]+$`, unique within the outline; `transitions[].from` must name an outline screen (`to` may point at an existing screen elsewhere).
- Field `name`s are **camelCase** and use the scaffold `--fields` types (`text | textarea | number | select | checkbox | date`); `select` fields must list `options`. Avoid scaffold-reserved names (`id`, `createdAt`, `updatedAt`, `deletedAt`, `organizationId`, `tenantId`, `page`, `pageSize`, `search`, `ids`, `format`, `full`, `all`, `exportScope`, `constructor`, `toString`, `valueOf`, `hasOwnProperty`) — promotion filters them out with a report.
- `userStory` tags match `US-…` and are how ledger counts trace blocks back to stories.
- `states` values come from the om-ux-product-design state matrix (`.ai/skills/om-ux-product-design/references/state-matrix.md`): `initial`, `loading`, `empty`, `no-results`, `partial`, `validation-error`, `system-error`, `offline`, `permission-denied`, `success`, `destructive`. Omitting a state the flow clearly needs is a review finding waiting to happen — list what the screen must cover.

## Process (om-ux-product-design steps 1-2, frozen as data)

1. **Define the problem.** Who is the user, what is the main task, what outcome ends it, what constraints apply. Unknowns become explicit assumptions — say so in your report, do not guess silently.
2. **Map the critical path.** Entry point → decisions/actions → data-required moments → completion → next step. Each stop on the path that needs its own screen becomes a `screens[]` entry, in `order`. Movement between them becomes `transitions` with the user action as `trigger`.
3. **Decompose each screen into intents.** `list` for browsing collections, `form` for capture, `detail` for one record, `dashboard` for KPI reads, `feedback` for confirmations/empty guidance, `action`/`navigation` for everything that names an exit or next step. Put the REQUIRED DATA in `fields` — that is what makes the draft table columns and form fields real instead of guessed, and what the promote bridge later turns into the scaffold `--fields` DSL.
4. **Pull states from the state matrix** per screen; record them in `states`.
5. **Link stories.** Every intent that serves a specific story carries its `userStory` tag.

## Handoff — the chain

```
om-ux-flows → om-ds-mockup (draft) → om-ux-heuristics → om-ux-copy → iterate → finalize → promote
```

- Generate drafts: `yarn ds:mockups:draft .ai/mockups/<name>.flow.json` (add `--force` to regenerate an existing draft; hand-edited non-draft documents are never overwritten). Every generated document is `draft: true`, every block `status: "proposed"` — a draft is a starting point, **never auto-final**; the flag only clears through an explicit finalize action after human review.
- Agent path without the CLI: build the outline JSON, validate it against `flowOutline`, and call `generateDraftDocuments` from `packages/core/src/modules/design_system/mockups/generation.ts` — same mapping, same guarantees.
- Golden reference pair: `.ai/mockups/customers-quick-add.flow.json` → `.ai/mockups/customers-quick-add.mockup.json` (pinned by `flow-generation.test.ts`).
- Unmappable intents (`action`, `navigation`, intents without fields) become honest placeholders labeled with the intent description — report every one to the reviewer; they are compose-by-hand work, not failures.

## Never

- Never hand a raw story to `om-ds-mockup` — the outline is the contract; prose stays here.
- Never invent fields the story does not imply without tagging the invention as an assumption in your report.
- Never mark or treat a generated draft as final, shareable, or promotable — review comes first, and the finalize step is a human decision.
