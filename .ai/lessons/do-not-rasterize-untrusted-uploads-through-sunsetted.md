---
title: "Do not rasterize untrusted uploads through sunsetted external converters"
modules: ["ai_assistant","data_sync","queue"]
areas: ["ai-workflow","testing","module-data"]
topics: ["media","testing","workers"]
---

# Do not rasterize untrusted uploads through sunsetted external converters

**Context**: The attachments module OCR path rasterized uploaded PDFs through `pdf2pic -> gm -> Ghostscript` before sending page images to the LLM.

**Problem**: Deprecated converters and delegate-based document parsers expand the attack surface for untrusted uploads and can introduce host-level RCE chains outside the TypeScript codebase.

**Rule**: For untrusted uploads, do not introduce or keep sunsetted external converter chains (for example `pdf2pic`, `gm`, or Ghostscript delegates) in default request/background pipelines. Prefer native parsers, best-effort text extraction, or isolated sandboxed workers. If the safer path is not ready, disable the risky format-specific processing rather than keeping it enabled.

**Applies to**: `attachments`, document preview/thumbnail pipelines, OCR services, importers, and any future upload-processing worker.
