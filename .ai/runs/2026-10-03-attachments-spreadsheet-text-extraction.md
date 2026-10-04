# Execution Plan — Attachments: pure-JS, bounded spreadsheet text extraction

Engine: om-auto-create-pr (steps: 10, --loop: no)

## Goal

`extractAttachmentContent` returns `null` for spreadsheets today, so `attachments.content` stays empty for every `.xlsx` upload. Restore spreadsheet text extraction in pure JS, in-process, with explicit resource bounds — the direction #1481 and #6264 set for PDFs.

## Scope

- `packages/core/src/modules/attachments/lib/spreadsheetText.ts` (new): the only file importing the reader library; streams rows sheet by sheet and renders `## <sheet>` + tab-separated rows.
- `packages/core/src/modules/attachments/lib/xlsxSheetNames.ts` (new): reads sheet names from the package relationships and the workbook part only, each entry inflated through `zlib` with `maxOutputLength`.
- `packages/core/src/modules/attachments/lib/textExtraction.ts`: detect `.xlsx` / `.xlsm` / `.xltx` / `.xltm`, dispatch to the wrapper.
- `packages/core/src/modules/attachments/lib/ocrLimits.ts`: env-configurable bounds next to the OCR limits.
- Dependency: `hucre@1.2.0`, pinned exactly (MIT, zero dependencies, pure TS/ESM) in `@open-mercato/core`, imported only via `hucre/xlsx` and only for `streamXlsxRows`.
- Unit tests with workbooks built in the test; `attachments/__integration__/TC-ATT-017.spec.ts` uploads an `.xlsx` and reads back `content`, and checks that a corrupt workbook still uploads; docs and `.env.example` (+ create-app template).

## Non-goals

- Legacy `.xls` (BIFF8) and `.xlsb` — follow-ups (fixtures / upstream cell cap).
- `.ods` — deferred until a fix lands upstream in the library.
- PPTX, MSG, formula evaluation, style-based number formatting, images.
- `.xlsx` support in `sync_excel` / WMS imports, replacing the `staff` XLSX writer, moving the wrapper to `packages/shared`.

## Implementation Plan

### Phase 1: Dependency and limits

- 1.1 Add `hucre@1.2.0` to `@open-mercato/core`, pinned exactly.
- 1.2 Add `resolveSpreadsheetMaxUncompressedBytes`, `resolveSpreadsheetMaxSheets`, `resolveSpreadsheetMaxCells`, `resolveSpreadsheetMaxTextChars` to `ocrLimits.ts` with unit tests.

### Phase 2: Extraction

- 2.1 Add `spreadsheetText.ts` and `xlsxSheetNames.ts`: sheet names from the workbook part, rows via `streamXlsxRows` one sheet at a time, sheet/scanned-cell/text caps with `logger.warn` on truncation, failures → `null` + `reportError` under `attachments.spreadsheet_encrypted`, `attachments.spreadsheet_entry_too_large` or `attachments.spreadsheet_extraction_failed`.
- 2.2 Dispatch spreadsheets from `extractAttachmentContent`; narrow the unsupported-formats comment.
- 2.3 Unit tests: shared/inline strings, numbers, booleans, dates, multiple sheets, empty sheet, `.xlsm`, password-protected and corrupt files, decompression cap (incl. partial text kept), sheet cap, cell cap, text cap, shared-string amplification, cell-image parts never decompressed; sheet names across prefixed markup, entities, a non-default workbook path, a ZIP64 central directory, duplicate entries (the last wins, as in the streaming reader), linear-time scanning of unclosed tags and the error codes for encrypted and oversized input; integration test TC-ATT-017; test workbooks come from one builder, `attachments/__integration__/helpers/xlsxWorkbook.ts`, and a boundary test fails when anything in `@open-mercato/core` other than `spreadsheetText.ts` and that builder imports `hucre`.

### Phase 3: Docs and configuration

- 3.1 Document the env vars in `apps/mercato/.env.example` and mirror into the create-app template.
- 3.2 Update `apps/docs/docs/api/attachments.mdx`, the bounds table in `framework/security/rate-limiting.mdx` and the format table in `.ai/specs/2026-04-27-ai-agent-attachment-processing-and-context.md`.

### Phase 4: Validation

- 4.1 Run the validation gate and the attachments test suite.

### Phase 5: Hardening after benchmark

- 5.1 Bound concurrent spreadsheet parsing per process (`OM_ATTACHMENT_SPREADSHEET_MAX_CONCURRENCY`, `OM_ATTACHMENT_SPREADSHEET_MAX_WAIT_QUEUE`), skipping extraction when the wait queue is full.
- 5.2 Lower the per-entry default to 5 MiB and document why next to each bound.

## Risks

- New production dependency needs maintainer sign-off (AGENTS.md § Ask First) — requested in the tracking issue; the jszip-only fallback stays available.
- `hucre` ships ESM only; Jest must be able to load it.
- Built on top of #6264 (same file); rebase after it merges.
- Shared-strings parsing costs ~40–50× its size in memory (10 MiB → ~480 MB peak; SheetJS 244 MB, exceljs 126–164 MB, read-excel-file 149 MB on the same file) and is repeated per sheet by the streaming reader — hence the 5 MiB per-entry default, the 10-sheet cap and the per-process concurrency slot. A single-pass read needs a multi-sheet streaming API upstream.
- hucre's `readXlsx` is never called: even with no sheet selected it reads every auxiliary part of the workbook (images, external links, pivot caches), which text extraction does not need. `streamXlsxRows` touches only the content types, relationships, workbook, shared strings, styles and the selected worksheet, each under the per-entry cap.
- Reader choice: hucre is the only candidate with an enforced decompression cap (an entry inflating past its declared size is rejected) and a streaming row reader that stops parsing on early exit. read-excel-file is faster on benign files (100k rows: 1.7 s vs 1.8 s) but allocates each archive entry at its declared size and pads the grid to unbounded cell addresses; SheetJS has no decompression cap and its npm copy carries unpatched high advisories; exceljs has had no release since 2023-10 and no inflate cap.
- `yarn audit` (`scripts/audit-ci.mjs --severity high`) reports 13 advisories on this base, none in `hucre`; upstream `develop` pins them via `resolutions`, so they clear on rebase.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Dependency and limits

- [x] 1.1 Add hucre dependency
- [x] 1.2 Spreadsheet limit resolvers

### Phase 2: Extraction

- [x] 2.1 Spreadsheet text wrapper
- [x] 2.2 Dispatch from extractAttachmentContent
- [x] 2.3 Unit tests

### Phase 3: Docs and configuration

- [x] 3.1 Env example and template sync
- [x] 3.2 Docs and spec format table

### Phase 4: Validation

- [x] 4.1 Validation gate — local runner, Node 24.13: build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage, typecheck, build:app and template:sync green; test: core 18,915 passed / 18 skipped, cli 1,964, shared 2,612, enterprise 1,989, ai-assistant 1,532; unrelated suites lost to Jest worker SIGSEGVs pass in isolation; attachments unit tests: 34 suites / 306 tests; attachments integration suite on an ephemeral environment: 16 passed incl. TC-ATT-017, TC-ATTACH-XSS-001 skipped by design, TC-ATT-004…007 not run (S3 only)

### Phase 5: Hardening after benchmark

- [x] 5.1 Concurrency slot for spreadsheet parsing
- [x] 5.2 Lower entry-size default and document rationale
