# Explicit direct mode for MCP Code Mode execution

## Goal

Make MCP Code Mode execution with mutation authority an explicit operator choice.

## Scope

MCP exposure policy, Code Mode tool registration, focused policy tests, and operator documentation.

## Implementation plan

Require explicit direct configuration for Code Mode execution. Reuse the shared exposure decision for discovery and invocation. Preserve Code Mode discovery and ordinary typed tools. Document the deployment choice and verify the expected behavior across mutation modes.

## Risks

Clients that rely on implicit Code Mode execution may need to migrate to typed tools or deliberately configure direct mode.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: MCP exposure policy

- [x] 1.1 Require explicit direct mode for Code Mode execution — 95f5a0101a
- [x] 1.2 Verify exposure and update operator documentation — 95f5a0101a
