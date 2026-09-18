---
title: "Inject TypeScript types into LLM tool descriptions for correct API payloads"
modules: ["ai_assistant","events","search"]
areas: ["ai-workflow","backend-ui","module-data"]
topics: ["events","runtime-startup","testing"]
---

# Inject TypeScript types into LLM tool descriptions for correct API payloads

**Context**: The AI Code Mode tools (`search` + `execute`) require the LLM to construct API payloads. When the LLM must query a separate tool to discover schema fields and then mentally translate a compact JSON format, it frequently constructs wrong payloads and enters debug spirals (20+ tool calls, 50+ API requests).

**Problem**: Without inline type information, the LLM guesses field names and structures, sends bad payloads, gets 400 errors, then experiments with variations — wasting tokens and user time.

**Rule**: For LLM-facing tools that construct structured API calls, pre-generate compact TypeScript type stubs from the OpenAPI spec at startup and inject them directly into the tool description. This mirrors Cloudflare's `generateTypes()` pattern. The LLM sees the correct types immediately without needing an extra discovery step.

**Applies to**: Any AI tool that requires the LLM to construct structured payloads (API calls, database queries, form submissions).
