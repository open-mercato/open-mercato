🤖 `om-auto-continue-pr-loop` — checkpoint 7 verification (lightweight)

Steps 6.1–6.5 (f518ea49f through 10c8138ca) complete — Phase 6 (UI) closed. Runner: local, reduced validation mode (user request: full typecheck/build/generate runs froze the machine).

| Check | Result |
|---|---|
| Hook builders test | ✅ 11 tests |
| Preview state + PreviewPanel tests (jsdom/RTL) | ✅ 7 tests |
| Catalogue columns/grouping test | ✅ 2 tests |
| History columns test | ✅ 3 tests |
| ResourceDocumentsPanel + Sales tab injection tests | ✅ 5 + 2 tests |
| Package typecheck / lint / build / `yarn generate` / `check:client-boundaries` | ⏸ deferred (reduced validation mode) |
| UI / browser verification + screenshots | ⏸ deferred — requires a running app with the new migration applied (pending user approval) |

Delivered UI:
- Public components: `TemplatesList` (+ view/item/loader), `PreviewPanel` (PDF Blob iframe + open-in-new-tab, Markdown as text, guarded generate download, Cmd/Ctrl+Enter, Escape), `HistoryList` (one table for organization-wide and record-scoped views; only the four API-allowlisted columns sortable), `ResourceDocumentsPanel` (scoped history refresh via query-key prefix invalidation).
- Backend pages: `/backend/document-generators` (hidden redirect), `/overview`, `/templates` (grouped catalogue + facet filters), `/history` (filters, server sorting, pageSize 20).
- Sales: lazy `sales.injection.document-generators-{order,quote}-tab` widgets added as second `kind: 'tab'` entries on the existing `sales.document.detail.{order,quote}:tabs` spots; existing history tab untouched.
