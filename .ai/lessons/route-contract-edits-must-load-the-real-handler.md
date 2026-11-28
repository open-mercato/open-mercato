---
title: "Route contract edits must load the real handler"
modules: ["attachments"]
areas: ["testing"]
topics: ["api-contracts","runtime-startup","testing"]
---

# Route contract edits must load the real handler

**Context**: Adding a storage-policy HTTP response referenced a shared error schema while one route still used a differently named local schema.

**Problem**: The route failed at module evaluation even though the storage policy's isolated unit tests passed.

**Rule**: After changing route exports or OpenAPI declarations, run the real route-handler test before broader validation. Confirm every response-schema identifier is imported or declared in that exact module; neighboring routes are not interchangeable templates.

**Applies to**: Public route wrappers, OpenAPI error declarations, and contract edits shared across several route files.
