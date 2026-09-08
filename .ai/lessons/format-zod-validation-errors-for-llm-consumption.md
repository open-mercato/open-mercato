---
title: "Format Zod validation errors for LLM consumption"
modules: ["ai_assistant","shared"]
areas: ["ai-workflow","debugging"]
topics: ["testing","validation-errors"]
---

# Format Zod validation errors for LLM consumption

**Context**: When the API returns 400 errors with raw Zod validation output (nested `issues[]` arrays, `fieldErrors` maps, or raw arrays), the LLM struggles to interpret the error structure and extract actionable fix instructions.

**Problem**: The LLM sees verbose JSON like `[{"code":"invalid_type","expected":"string","path":["lines",0,"currencyCode"]}]` and may not correctly identify which field to fix, leading to trial-and-error debugging.

**Rule**: Format validation errors into a concise human-readable string before returning to the LLM. Handle all Zod error formats (v3 `issues[]`, v4 `fieldErrors`/`formErrors`, raw arrays) and produce fix instructions like `"Validation failed — lines[0].currencyCode: expected string. Fix the listed fields and retry."` Fall back to `JSON.stringify` for unrecognized formats.

**Applies to**: Any AI-facing API wrapper that surfaces validation errors to an LLM agent.
