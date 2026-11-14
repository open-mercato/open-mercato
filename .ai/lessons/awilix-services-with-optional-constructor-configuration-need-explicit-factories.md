---
title: "Awilix services with optional constructor configuration need explicit factories"
modules: ["attachments"]
areas: ["architecture","testing"]
topics: ["provider-lifecycle","runtime-startup","testing"]
---

# Awilix services with optional constructor configuration need explicit factories

**Context**: A quarantine store accepted an optional root path in its constructor. Registering it with `asClass` under Awilix PROXY injection supplied the DI cradle as that path, so the service resolved successfully but failed only when it tried to persist a quarantined file.

**Rule**: Register classes that accept optional scalar or configuration constructor arguments with an explicit `asFunction` factory. Add a DI-resolution test that exercises the first real operation, not only `hasRegistration()` or `resolve()`.

**Applies to**: Module DI registrations for storage roots, timeouts, policy values, provider settings and other constructor configuration that is not a named cradle dependency.
