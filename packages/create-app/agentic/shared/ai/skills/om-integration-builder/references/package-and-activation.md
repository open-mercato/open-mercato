# Package and Activation

Load this reference for reusable provider delivery.

1. Create a dedicated provider package/module with compatible peer/runtime dependencies, public exports, build/prepack, and compiled discovery output.
2. Add `integration.ts`, `di.ts`, `acl.ts`, `setup.ts`, validators, services/adapters, health check, events, and only the UI/worker/CLI surfaces needed.
3. Persist credentials/state/logs/mappings through generic integration/data-sync services; do not duplicate host tables.
4. If env bootstrap is needed, implement a provider-prefixed preset inside provider `setup.ts` and an idempotent rerun CLI.
5. Enable dependency and module entry in the consumer. Run generation against the packed/installed package.
6. Test missing provider configuration as `unconfigured`/degraded, not a crash or secret leak.

Record the supported host/framework version range and test package exports from a fresh standalone consumer.
