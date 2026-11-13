---
title: "Choose a JSON reader for the response type"
modules: ["documents"]
areas: ["testing","integration"]
topics: ["testing","type-normalization"]
---

# Choose a JSON reader for the response type

**Context:** The Documents browser regression in PR #9027 reads the result of
`page.waitForResponse()`. Replacing its inline JSON catch with the integration
API helper caused TS2739: Playwright browser `Response` lacks the disposal
members required by `APIResponse`.

**Rule:** Check the actual response type before selecting a defensive reader.
Keep the integration `readJsonSafe` helper for `APIResponse` fixtures. For a
browser response, pass `await response.text()` to the existing shared HTTP JSON
reader, which accepts a string. Do not hide the mismatch with a cast or restore
an inline JSON catch.

**Verification:** Inspect the reader signature and run typechecking for the
browser spec; a runtime-compatible `.text()` method alone does not prove that
the helper's declared parameter accepts the object.
