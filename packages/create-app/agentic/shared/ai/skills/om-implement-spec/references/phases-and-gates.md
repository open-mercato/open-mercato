# Spec Phases and Gates

Load this reference before implementation.

1. Build a requirement-to-phase matrix with acceptance path, affected modules/packages, routed guides/skills, dependencies, BC surfaces, schema impact, and test oracle.
2. Order by foundations then complete vertical slices. Every phase leaves generation/typecheck/tests working.
3. Assign independent research, implementation, integration-test, and review tasks to bounded subagents when available; one owner per file/slice.
4. After each slice, run focused tests and record files/commands/results plus remaining work in the spec/progress artifact.
5. Run schema probe at the data slice; run generation at each discovery slice; never defer all integration until the end.
6. Final gate: all spec API/UI paths with self-contained fixtures, affected safety cases, typecheck/lint/test/build, packed standalone boundary when relevant, and code review findings resolved.

If an acceptance criterion cannot be met without scope/architecture/public-contract change, stop and ask rather than silently revising the spec.
