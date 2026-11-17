# Execution plan — fix Anthropic Claude 4.6 model IDs

## Goal

Make Claude Sonnet 4.6 and Claude Opus 4.6 selectable and callable from the AI Assistant by replacing the non-existent IDs in the Anthropic adapter's curated catalog with the real ones.

## Context

`packages/ai-assistant/src/modules/ai_assistant/lib/llm-adapters/anthropic.ts` lists `claude-sonnet-4-6-20260107` and `claude-opus-4-6-20260107`. Anthropic's API answers both with `404 not_found_error`; the valid IDs are `claude-sonnet-4-6` and `claude-opus-4-6` (the 4.6 models have no dated snapshot ID). The bad IDs were introduced in `54cd746c6e` (PR #1514), most likely by pattern-copying the dated `claude-haiku-4-5-20251001` entry. Nothing else in the repo (presets, `.env.example`, create-app template, docs, tests) still carries them — the `.env.example` comments were dropped in #1856.

## Scope

- `packages/ai-assistant/src/modules/ai_assistant/lib/llm-adapters/anthropic.ts` — the two catalog IDs.
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/llm-adapters-anthropic.test.ts` — regression test.

## Non-goals

- No runtime remapping of previously stored IDs (agent overrides, tenant model allowlists). Those configurations already fail with 404; users re-select the model.
- No re-audit of the rest of the catalog (context windows, tags, other providers).
- No change to the default model (`claude-haiku-4-5-20251001`).

## Implementation Plan

### Phase 1: Fix catalog IDs

1. Replace the two IDs in `DEFAULT_MODELS` and add a regression test asserting the 4.6 entries use the undated IDs.

## Risks

- Tenants that allowlisted the bad ID will no longer see Sonnet/Opus 4.6 in the picker until an admin adds the new ID. Noted in the PR body.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix catalog IDs

- [ ] 1.1 Replace Claude 4.6 catalog IDs and add regression test
