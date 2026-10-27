---
title: "Root-level tsx workflow entrypoints must avoid top-level await"
modules: ["create_app"]
areas: ["testing"]
topics: ["package-runtime","testing"]
---

# Root-level tsx workflow entrypoints must avoid top-level await

**Context**: A snapshot workflow invoked `yarn tsx scripts/prepare-standalone-example-integration.ts`, but the root package has no ESM `type` declaration. tsx therefore transformed the entrypoint as CommonJS.

**Problem**: Top-level `await` made the helper fail during transformation before it could verify or activate the standalone fixture. The workflow-source test only checked YAML ordering, so it could not detect that the referenced command was unexecutable.

**Rule**: Root-level TypeScript entrypoints invoked directly by workflows must wrap asynchronous work in an `async main()` and call it without top-level `await`. Add an execution-level regression through the tsx CLI so the test exercises the root package's real module mode, not only the workflow text.

**Applies to**: `scripts/*.ts` entrypoints called by `.github/workflows/**`, especially standalone create-app and snapshot helpers.
