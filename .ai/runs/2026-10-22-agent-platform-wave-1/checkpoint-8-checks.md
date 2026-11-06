# Checkpoint 8 — Steps 7.1..7.5 (Phase 7 close)

- **Recorded:** 2026-10-22T22:30:16Z
- **Steps:** 7.1–7.5 (commits a3d44b1f0..15995cd08)
- **Touched areas:** `packages/core` `attachments`: `lib/documentStructure/{types,locator,structurer}.ts`, `engines/{text,pdfLayout,docx,registry}.ts`, shared `lib/pdfJsLoader.ts` (extracted from `textExtraction.ts`)
- **Runner:** local mode

| Check | Result | Notes |
|---|---|---|
| core `attachments` jest | ✅ pass | 38 suites, 360 tests (real PDFs synthesized with pdf-lib and parsed in a `node --import tsx` child process, since pdfjs cannot load under Jest; DOCX built at runtime with jszip) |
| core `tsc --noEmit` | ✅ pass | 0 errors |
| `yarn build:packages` | ✅ pass | |
| app typecheck (direct) | ✅ pass | |
| UI verification | ⏭️ skipped | no UI in this window |

## Notes for review
- Engines are pure (no persistence yet): registry order `pdf_layout, docx, text`; locators stay compatible with the AO `page:` format; anchors derive from number labels so heading rewording does not move them.
- Not covered by a real file: encrypted PDFs (pdf-lib cannot encrypt; covered via an injected loader). Pages beyond the page cap are reported via `pageCharCounts.length < pageCount`; the Phase 8 worker must mark such extractions `partial`.
- Review item: the DOCX test imports `jszip` (installed via mammoth) without `packages/core` declaring it as a devDependency.
