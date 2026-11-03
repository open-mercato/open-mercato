---
title: "Akeneo media identifiers can be slash-delimited path params"
modules: ["data_sync","cli"]
areas: ["integration"]
topics: ["data-import","media"]
---

# Akeneo media identifiers can be slash-delimited path params

**Context**: Akeneo media values looked like file paths (`6/7/7/...jpg`). The importer treated them as opaque codes and URL-encoded the entire string before calling `/api/rest/v1/media-files/{code}`.

**Problem**: Encoding the whole identifier as one segment changed the path semantics and caused false `media file ... was not found` failures, which then prevented attachments from being created and assigned.

**Rule**: For Akeneo media-file endpoints, preserve `/` path separators inside the media identifier and only encode each path segment individually. Treat these identifiers as route params, not as a single opaque slug.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/lib/client.ts`, media download helpers, and any future Akeneo endpoint that accepts slash-delimited resource identifiers.
