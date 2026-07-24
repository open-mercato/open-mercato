# Package and Activation

Load this reference to choose provider ownership before creating files.

1. **App-specific (default):** create `src/modules/<provider>/`, add `integration.ts`, `di.ts`, `acl.ts`, `setup.ts`, validators, services/adapters, health, events, and only needed UI/worker/CLI surfaces; activate it in `src/modules.ts` and run generation/typecheck/focused tests in this app.
2. **Reusable (explicit user requirement):** create a separate publishable package/repository with compatible peer/runtime dependencies, public exports, build/prepack, and compiled discovery output. Add its packed artifact to the standalone app as a dependency and activate it in `src/modules.ts`.
3. Do not create `packages/*` or add workspace configuration inside a standalone app unless the user explicitly approves that architecture change. Ask before adding the reusable provider's production dependency.
4. Persist credentials/state/logs/mappings through generic integration/data-sync services; do not duplicate host tables.
5. If env bootstrap is needed, implement a provider-prefixed preset inside provider `setup.ts` and an idempotent rerun CLI.
6. Test missing provider configuration as `unconfigured`/degraded, not a crash or secret leak.

On the reusable branch, record the supported host/framework version range and test package exports from a fresh standalone consumer. Do not impose packed-consumer work on the local-module branch.
