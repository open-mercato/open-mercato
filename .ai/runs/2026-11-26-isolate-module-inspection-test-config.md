# Isolate npm settings in module inspection unit tests

## Goal

Run the module-inspection unit suite with controlled registry fixtures. A failed assertion must report the condition that failed without printing the registry configuration.

## Progress

PR: #10829

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Test isolation

- [x] 1.1 Set a test-local npm user-config path and keep authentication assertions value-free — a7128b7d3e
- [x] 1.2 Verify with a synthetic ambient npm registry config — a7128b7d3e
