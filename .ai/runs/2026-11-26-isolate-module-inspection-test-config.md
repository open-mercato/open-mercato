# Isolate npm settings in module inspection unit tests

## Goal

Run the module-inspection unit suite with controlled registry fixtures. A failed assertion must report the condition that failed without printing the registry configuration.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Test isolation

- [ ] 1.1 Set a test-local npm user-config path and keep authentication assertions value-free
- [ ] 1.2 Verify with a synthetic ambient npm registry config
