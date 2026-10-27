---
title: "Blur suppression must guard the whole validation pipeline"
modules: ["ui"]
areas: ["backend-ui","testing"]
topics: ["schema-composition","testing","validation-errors"]
---

# Blur suppression must guard the whole validation pipeline

**Context**: `CrudForm` can combine built-in required checks, custom-field validation, and a Zod schema in one blur-validation pass.

**Problem**: Guarding only the built-in required branch for an untouched field lets later schema validation run and surface a raw Zod error, defeating the intended no-nag behavior.

**Rule**: When untouched fields should skip blur validation, exit before every validation branch. Cover the behavior with a schema-backed field that rejects `undefined`, and separately preserve submit-time validation for untouched required fields.

**Applies to**: Shared form validation pipelines that compose built-in and schema/custom validators.
