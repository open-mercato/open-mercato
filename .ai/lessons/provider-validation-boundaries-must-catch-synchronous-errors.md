---
title: "Provider validation boundaries must catch synchronous errors"
modules: ["security"]
areas: ["architecture", "testing"]
topics: ["validation-errors", "provider-lifecycle"]
---

# Provider validation boundaries must catch synchronous errors

**Context:** Passkey enrollment validation must produce a controlled 400 without activating the pending method. A provider implementing a Promise-returning interface can still validate and throw before returning its Promise.

**Rule:** Wrap the provider invocation and `await` together in `try/catch`. Attaching `.catch()` only to the returned Promise misses synchronous validation errors. Test both invocation-time throws and rejected Promises, assert no activation/flush/event, and preserve non-validation failures.

- 2026-10-01 · security (#6800): the synchronous-provider regression returned a raw `ZodError` until the service boundary covered the invocation itself.
