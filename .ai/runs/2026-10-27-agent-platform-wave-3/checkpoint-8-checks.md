# Checkpoint 8 — Steps 6.1..6.3 (Phase 6 close)

- **When:** 2026-10-27
- **Steps covered:** 6.1..6.3 (`da81ad140`, `e2b661492`, `818f0e12f`)
- **Touched areas:** attachments `ai-tools.ts` (`attachments.get_document_sections`), `packages/ui` `DocumentStructurePanel` + Structure tab in `AttachmentMetadataDialog`, `AttachmentLibrary` (`canManageStructure`), attachments i18n (en/pl/de/es/ko), `TC-ATT-STRUCT-007`
- **Runner:** ephemeral integration environment (AO enabled, rebuilt with `OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS=0`) + local jest from the executors

## Checks

| Check | Result | Notes |
|---|---|---|
| attachments jest | pass | 53 suites, 545 tests (6.1, 6.2 executors) incl. `ai-tool.test.ts` |
| ui jest (panel, dialog, lazy-load guards) | pass | `DocumentStructurePanel.test.tsx`, `AttachmentMetadataDialog.test.tsx`, `lazy-heavy-libraries.test.ts` |
| Integration `TC-ATT-STRUCT-001..005, 007` | pass | 6 passed (incl. the new UI spec: outline, expand/collapse, Re-extract only for `attachments.manage`) |
| Browser screenshots | pass | structure panel as admin and as a view-only user; MCP exposure section (Step 1.5) and Playground agent picker (Step 2.4), which earlier checkpoints could not render |
| Static gate (typecheck, lint, i18n, build:app) | deferred | runs in the final gate after Phase 7 |

Artifacts (`checkpoint-8-artifacts/`): `screenshot-structure-panel-admin.png`, `screenshot-structure-panel-viewer.png`, `screenshot-mcp-exposure-section.png`, `screenshot-playground-agent-picker.png`, `integration-structure-specs.log`.
