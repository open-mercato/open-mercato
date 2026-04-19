# Step 4.9 — Verification Log

**Step:** 4.9 — Spec §10 (D18), `catalog.merchandising_assistant` read-only agent + `<AiChat>` sheet on products list
**Code commit:** `ebb060c5f`
**Timestamp:** 2026-04-18T23:45:00Z

## Files landed (code commit)

- `packages/core/src/modules/catalog/ai-agents.ts` — second agent definition + prompt template + barrel `aiAgents` array
- `packages/core/src/modules/catalog/__tests__/ai-agents.test.ts` — 12 new tests (now 23/23 total)
- `packages/core/src/modules/catalog/backend/catalog/products/MerchandisingAssistantSheet.tsx` — new drawer embedding `<AiChat>`
- `packages/core/src/modules/catalog/backend/catalog/products/page.tsx` — trigger + sheet wiring
- `packages/core/src/modules/catalog/components/products/ProductsDataTable.tsx` — selection/filter notifier for pageContext
- `packages/core/src/modules/catalog/i18n/{en,pl,es,de}.json` — 6 new `catalog.merchandising_assistant.*` keys each
- `packages/core/src/modules/catalog/__integration__/TC-AI-MERCHANDISING-008-products-sheet.spec.ts` — new Playwright spec

## Verification

| Check | Outcome | Notes |
|-------|---------|-------|
| `npx jest --config=packages/core/jest.config.cjs --testPathPatterns="catalog/.*ai-agents"` | ✅ | **23 tests** (was 11 for catalog.catalog_assistant; +12 for merchandising) |
| `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app` | ✅ | core cache miss rebuilt clean; app cached |
| `yarn generate` | ✅ | `ai-agents.generated.ts` imports `@open-mercato/core/modules/catalog/ai-agents` whose `aiAgents` barrel contains BOTH agents |
| `yarn i18n:check-sync` | ✅ | 46 modules × 4 locales in sync |

## Browser smoke

- `step-4.9-artifacts/products-list-with-ai-trigger.png` — button renders in the products list page header.
- `step-4.9-artifacts/merchandising-sheet-open.png` — sheet opens with `<AiChat>` composer + "acting on N products" pill when selection present.
- `step-4.9-artifacts/playground-three-agents.png` — picker shows all three agents (`customers.account_assistant`, `catalog.catalog_assistant`, `catalog.merchandising_assistant`).

Dev server reused (`yarn dev:app` task `bk93jo24j`, port 3000). Turbopack cache busted via `cd packages/core && node build.mjs` + `touch apps/mercato/next.config.ts`. Dev server never restarted.

## Decisions

- **UI primitive:** reused `packages/ui` `Sheet` component — no new primitive.
- **`pageContext` fields** match spec §10.1 verbatim (view / recordType / recordId / extra.filter / extra.totalMatching / extra.selectedCount). `selectedCount` and `recordId` update live on selection change; filter fields update on filter change via the DataTable's listener.
- **Prompt template** = spec §10.5 verbatim. Seven structured sections.
- **No RTL test for the sheet component** — the sheet is a thin listener over the DataTable; behavior is covered by the Playwright integration spec. Noted rather than bloating coverage.
- **Tool whitelist size:** 17 (7 D18 reads + 5 D18 authoring + 5 general-purpose). Deny-list tests enforce no mutation tools and no overlap with the generic catalog assistant's list/get surface.
- **Zero new ACL features.** Zero new routes.

## Next Step

**Step 4.10** — Backend + portal examples using existing injection/replacement patterns. Demonstrates the agent-to-page integration pattern outside the catalog demo so third-party modules can copy the wiring.
