# Session-share ZIP validation prerequisites

The session-share fixture tests require the repository-supported Node.js and Yarn,
Git (the preparer uses `git archive --format=zip`), and Info-ZIP `unzip` on `PATH`.
The ZIP reader is a validation-only prerequisite, not a runtime dependency of a
scaffolded application.

On a clean Debian/Ubuntu runner, install `git` and `unzip` with
`sudo apt-get update && sudo apt-get install -y git unzip`, then install repository
dependencies with `yarn install --immutable`. On macOS, provide Git through the
Command Line Tools (`xcode-select --install`) and verify the system `unzip` is on
`PATH`. Check prerequisites with `git --version` and `unzip -v`.

From the repository root, run the affected suite:

```sh
node --import tsx --test --test-timeout=120000 packages/create-app/src/lib/share-session*.test.ts
```

The fixture extracts the actual archived `src/generated.ts` with `unzip -p`,
asserts private values are absent, and compares its content with the sanitized
local review tree. A missing ZIP reader fails with an installation diagnostic;
privacy checks are never skipped. A regression test supplies an empty executable
search directory to verify this diagnostic even on runners with `unzip` installed.
