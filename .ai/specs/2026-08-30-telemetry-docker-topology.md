# OTLP Telemetry in the Standard Docker Topology

## 📝 TLDR

Wire the existing opt-in `@open-mercato/telemetry` runtime into the standard and standalone-app Docker Compose topologies. Operators will be able to pass the documented telemetry environment into the app container and start a diagnostic OpenTelemetry Collector through an explicit Compose profile, while telemetry remains completely off by default.

This supplements `.ai/specs/2026-04-29-telemetry-and-otel.md`, whose package architecture is already implemented and intentionally left deployment infrastructure out of scope. The independently deployable missing-optional-dependency behavior requested by the same issue is specified separately in `.ai/specs/2026-08-30-telemetry-otlp-missing-dependency-fail-fast.md`; both specs may land through one coordinated implementation PR without conflating their design contracts.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirmation |
|---|----------|-----------------|-----------|--------------|
| Q1 | Does issue #5783 describe one independently deployable capability, or should generic OTLP missing-dependency hardening be specified separately from Docker topology enablement? | Split the generic runtime hardening into a companion spec while keeping this document focused on Docker topology. | A fresh-context scope reviewer confirmed that either change can ship without the other; separate contracts keep both specs cohesive while issue #5783 can still coordinate their delivery. | ok |
| Q2 | Should the example collector be a commented Compose snippet or a profile-gated runnable service with a checked-in minimal configuration? | Add a profile-gated service and a checked-in minimal configuration that receives OTLP over HTTP and writes the three signals to the collector's debug exporter. | A runnable profile is testable and harder to rot than commented YAML; Compose profiles leave the default topology unchanged and are the official mechanism for opt-in services. | ok |

Neither default changes a public API, database schema, or the behavior of deployments that leave telemetry unset. No assumption requires human confirmation before implementation.

## 📝 Overview

Open Mercato already initializes telemetry from the web, worker, scheduler, and CLI host paths only after `isTelemetryBackendEnabled()` reports an explicit backend. The OTLP provider exports traces, metrics, and logs over OTLP/HTTP and auto-instruments `pg` and `undici`. The missing layer is deployment wiring: the app container receives none of the telemetry variables documented in `apps/mercato/.env.example`, and the supported topology has no collector service.

The implementation follows two established upstream mechanisms:

- Docker Compose profiles make optional services absent from the default application model and activate them only through `--profile` or `COMPOSE_PROFILES`, which is the correct fit for an off-by-default diagnostic collector ([Docker Compose profiles](https://docs.docker.com/compose/how-tos/profiles/)).
- The OTLP exporter standard uses `OTEL_EXPORTER_OTLP_ENDPOINT` as the common base URL and appends `/v1/traces`, `/v1/metrics`, and `/v1/logs` for OTLP/HTTP. A single in-network endpoint can therefore carry all three signals ([OpenTelemetry Protocol exporter specification](https://opentelemetry.io/docs/specs/otel/protocol/exporter/)).

The collector example intentionally uses the debug exporter rather than pretending to be a production backend. It gives operators a deterministic smoke-test destination and a starting configuration; production routing, retention, dashboards, and credentials remain choices of the selected observability backend.

## 📝 Problem Statement

The supported production-style Docker image contains the telemetry workspace and normally installs its optional dependencies, but runtime configuration stops at the host. `TELEMETRY_BACKEND` and the standard OTEL exporter variables are not passed through the `app` service in either the fullapp topology or the standalone create-app topology. Setting the variables in the host `.env` file therefore does not activate telemetry inside the container.

This creates three concrete failures:

1. Operators can follow the documented `.env.example` block and still receive no server-side traces, metrics, or remote logs from a standard Docker deployment.
2. There is no supported, local collector target with which to prove the pipeline before adding a vendor endpoint and credentials.
3. A custom image built without optional dependencies can explicitly request `TELEMETRY_BACKEND=otlp` and receive console fallback output, making a broken production configuration look partially healthy.

The 2026-08 production-topology benchmark exposed the operational consequence: query attribution fell back to `pg_stat_statements` and log scraping because the deployment topology could not enable the telemetry package already present in the codebase.

## 📝 Proposed Solution

### In scope

- Pass the complete documented telemetry configuration from the host environment into the `app` service in:
  - `docker-compose.fullapp.yml`;
  - `docker-compose.fullapp.traefik.yml`;
  - `packages/create-app/template/docker-compose.fullapp.yml`.
- Add a `telemetry` Compose profile containing an OpenTelemetry Collector service to the root and standalone-app templates.
- Add byte-equivalent minimal collector configuration files for the monorepo topology and the standalone template.
- Add deployment documentation, Compose contract tests, and template parity coverage.

### Out of scope

- New spans, metrics, log fields, sampling algorithms, or instrumentation packages.
- Browser/RUM telemetry.
- A bundled production observability backend, dashboards, storage, alerting, or retention.
- Publishing collector ports to the host by default.
- Changing telemetry provider initialization or dependency placement; the companion fail-fast spec owns that independent runtime behavior.
- Adding image build arguments or baking telemetry configuration into the Dockerfile. Runtime endpoints and credentials must remain runtime environment, not image metadata.

## 📝 Architecture

### Topology

```text
host .env
   |
   | selected TELEMETRY_* and OTEL_* values
   v
app container -- OTLP/HTTP --> otel-collector container -- debug exporter --> collector logs
       |                            ^
       |                            |
       +-- web/workers/scheduler ---+  shared Compose network, no host port
```

The existing app bootstrap remains the only activation authority. Compose merely passes values through; it does not infer, rewrite, or default `TELEMETRY_BACKEND`. With the variable unset, the host check prevents the telemetry package and SDK from loading exactly as today.

### Compose environment contract

Each app service passes these values without secrets or production defaults:

| Variable | Compose value | Purpose |
|----------|---------------|---------|
| `TELEMETRY_BACKEND` | `${TELEMETRY_BACKEND:-}` | Explicit selector: `otlp`, `signoz`, `newrelic`, `console`, or off when blank. |
| `TELEMETRY_SAMPLING_RATIO` | `${TELEMETRY_SAMPLING_RATIO:-}` | Optional SDK sampling override. |
| `TELEMETRY_TRUST_INBOUND_TRACE` | `${TELEMETRY_TRUST_INBOUND_TRACE:-false}` | Keeps inbound trace trust disabled unless the operator opts in. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `${OTEL_EXPORTER_OTLP_ENDPOINT:-}` | OTLP/HTTP base URL; for the bundled profile use `http://otel-collector:4318`. |
| `OTEL_EXPORTER_OTLP_HEADERS` | `${OTEL_EXPORTER_OTLP_HEADERS:-}` | Optional vendor authentication header string; remains runtime-only. |
| `OTEL_SERVICE_NAME` | `${OTEL_SERVICE_NAME:-open-mercato}` | Stable service identity. |
| `OTEL_RESOURCE_ATTRIBUTES` | `${OTEL_RESOURCE_ATTRIBUTES:-}` | Optional deployment/environment attributes. |

The standard OTEL endpoint and headers are passed verbatim. Compose files do not contain vendor credentials, example secrets, or an enabled backend default.

The Traefik file is an overlay and normally merges with `docker-compose.fullapp.yml`; it repeats the telemetry environment mapping under its `app` fragment because issue #5783 explicitly treats every supported topology file as a contract. A contract test locks the variable set across both root files and the standalone template so the duplication cannot drift silently.

### Collector profile

Both production-style Compose trees add an `otel-collector` service with:

- `profiles: [telemetry]`, so ordinary `docker compose up` does not create it;
- a version-pinned official OpenTelemetry Collector image;
- a read-only mount of `docker/otel-collector-config.yaml`;
- the existing `mercato-network-fullapp` network;
- no host-published ports;
- an OTLP receiver bound to the container network on `0.0.0.0:4318`;
- a batch processor and debug exporter for traces, metrics, and logs.

The OTLP receiver supports traces, metrics, and logs over HTTP, and `/v1/traces`, `/v1/metrics`, and `/v1/logs` are its standard paths ([OTLP receiver reference](https://pkg.go.dev/go.opentelemetry.io/collector/receiver/otlpreceiver)).

Operators start the diagnostic pipeline with an explicit command such as:

```bash
TELEMETRY_BACKEND=otlp \
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
docker compose -f docker-compose.fullapp.yml --profile telemetry up --build
```

The app does not declare a hard `depends_on` edge to the profiled collector. Such an edge would make the default profile invalid or couple startup to an optional diagnostic component. OTLP exporter retry behavior absorbs collector start order, and an unavailable collector must not prevent an otherwise valid app from running.

### Dockerfile decision

No Dockerfile configuration or dependency-category change is required. The existing runner stage copies `packages/telemetry/package.json` and runs `yarn workspaces focus @open-mercato/app --production`, which installs optional dependencies unless an image builder explicitly excludes them. Runtime telemetry configuration must not become Docker `ARG` or baked `ENV`, because endpoints and authentication headers vary per deployment and may contain secrets.

## 📝 Data Model

Not applicable. The change adds no entity, table, migration, cache, queue payload, persistent state, or tenant-scoped data. The collector example receives the existing redacted telemetry signals and writes them only to its ephemeral debug output.

## 📝 API Contracts

Not applicable. No HTTP route, CLI command, event, queue name, public TypeScript export, or generated registry changes. The only new operator contract is additive Compose environment pass-through plus the optional `telemetry` profile.

## 📝 UI/UX

Not applicable. There is no application UI. The operator experience is documented Compose commands, expected collector log output, and troubleshooting for absent SDK packages or an unreachable collector.

## 📝 Deployment and Operations

The runtime documentation adds a dedicated telemetry page and links it from the framework runtime sidebar. It covers:

1. the unchanged off-by-default behavior;
2. direct export to a managed OTLP endpoint;
3. local diagnostic export through `--profile telemetry`;
4. the exact environment variables forwarded by Compose;
5. how to inspect collector logs for all three signals;
6. the difference between a diagnostic debug exporter and a production backend;
7. failure messages for omitted optional dependencies and an unreachable endpoint;
8. the security rule that exporter headers stay in deployment secrets and must never be committed.

The existing structured-logging page links to the deployment page instead of duplicating the environment table.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Required behavior | Verification |
|----------|-------------------|--------------|
| Telemetry variables are absent | Compose passes blank/default values; app bootstrap does not import telemetry; collector profile is absent. | Compose contract test plus existing default-unloaded/Next.js tests. |
| Collector profile starts after the app | App remains up; exporter retries until the receiver is available. | Compose smoke command documented; no hard dependency edge. |
| Collector is unavailable after startup | Application behavior continues; exporter failures remain telemetry-layer failures and are observable in logs. | Existing provider isolation behavior; documentation. |
| `OTEL_EXPORTER_OTLP_HEADERS` contains credentials | Value is passed only as runtime environment, never echoed by tests/docs or stored in image layers. | Source review and secret-free fixtures. |
| Root and template Compose files drift | Contract test fails on missing/mismatched telemetry variables, profile, mount, or collector config parity. | New Node test and template sync gate. |
| Traefik overlay is used with the base file | Overlay merge retains the same telemetry values and labels; no duplicate service is created. | `docker compose config` validation when Docker Compose is available. |

## 📝 Migration & Backward Compatibility

This is additive for all default and supported deployments:

- telemetry remains off when `TELEMETRY_BACKEND` is unset, blank, `noop`, or unknown;
- no existing environment variable is renamed or removed;
- no public function, type, import path, API route, event, schema, DI key, feature ID, notification ID, CLI command, or generated file changes;
- default `docker compose up` starts the same services as before because the collector is profile-gated;
- direct managed-backend export continues to work without starting the bundled collector.

Rollback is a normal code/config rollback: remove the environment mappings and collector service/config. No stored data or migration state exists.

## 📝 Testing Strategy

### Deployment contract tests

- Add a root Node test that asserts the app environment contains the exact telemetry variable set in the base, Traefik overlay, and standalone template Compose files.
- Assert the collector is profile-gated, mounts the expected config read-only, joins the app network, and publishes no host ports.
- Assert the monorepo and standalone collector configs are byte-identical and define OTLP/HTTP receiver, batch processor, debug exporter, and trace/metric/log pipelines.
- Run `docker compose ... config` for the base and base+Traefik combinations when the CLI is available; the deterministic source assertions remain the CI-safe gate when Docker is unavailable.
- Run `yarn template:sync` to ensure app-shell/template rules remain satisfied and the targeted standalone tests covering copied Docker assets.

### Documentation and integration coverage

- Build the docs application or run its smallest available link/build validation so the new sidebar route resolves.
- Manual smoke, documented rather than made a mandatory networked CI test: start the telemetry profile, make one app request and one database-backed request, then verify collector logs contain at least one trace, metric, and log record.
- No browser/UI QA is required because no rendered application surface changes.

## 📝 Risks & Impact Review

### Collector debug output exposes telemetry to container logs

- **Scenario**: An operator enables the example profile in a shared environment and forwards collector logs more broadly than intended.
- **Severity**: Medium.
- **Affected area**: Deployment log pipeline.
- **Mitigation**: Keep the profile opt-in, publish no collector ports, retain existing provider-boundary redaction, label the debug exporter diagnostic-only, and document replacement with a production exporter.
- **Residual risk**: Redacted span names and low-cardinality attributes are still operational metadata; operators must apply their normal log access controls.

### Compose duplication drifts

- **Scenario**: A telemetry variable or collector setting is updated in the root topology but omitted from the Traefik overlay or standalone template.
- **Severity**: Medium.
- **Affected area**: Monorepo and generated standalone deployments.
- **Mitigation**: Lock the exact environment set and byte-identical collector configs with a deterministic test; include the create-app template in the same implementation step.
- **Residual risk**: Comments may still differ intentionally, but runtime keys and collector behavior are guarded.

### Collector or backend is unreachable

- **Scenario**: The app starts before the collector, DNS is wrong, or a managed endpoint is unavailable.
- **Severity**: Low.
- **Affected area**: Telemetry export only.
- **Mitigation**: Do not make the app depend on the optional collector; rely on OTLP exporter retries and preserve provider failure isolation after successful initialization.
- **Residual risk**: Telemetry may be delayed or dropped during a prolonged outage, but business traffic continues.

### Image and startup cost

- **Scenario**: Operators assume the profile adds no cost while optional SDK packages are still installed in standard production images.
- **Severity**: Low.
- **Affected area**: Image size and telemetry-enabled startup.
- **Mitigation**: Keep default runtime unloaded, document that `optionalDependencies` are normally installed, and avoid adding any dependency or image layer in this change.
- **Residual risk**: Standard images retain the existing OTEL package bytes; there is no new delta from dependency placement.

## 📋 Phasing

### Phase 1 — Standard topology wiring

Pass the complete environment contract through every supported app Compose surface and add the diagnostic collector profile/config to both the monorepo and standalone template.

### Phase 2 — Operator documentation and validation

Document direct and collector-backed activation, lock topology/template parity with tests, and validate the full change through the repository's configured gate.

Both phases ship together because environment pass-through without a documented/testable collector path would leave the same operator dead end, while a collector profile without app wiring could receive nothing from the standard topology.

## 📋 Implementation Plan

### Phase 1 — Standard topology wiring

1. Add the exact telemetry environment mapping to the `app` services in `docker-compose.fullapp.yml`, `docker-compose.fullapp.traefik.yml`, and `packages/create-app/template/docker-compose.fullapp.yml`.
2. Add the `otel-collector` service under `profiles: [telemetry]` to the root and standalone Compose files, using the shared service name, internal network, version-pinned image, read-only config mount, and no published ports.
3. Add byte-identical `docker/otel-collector-config.yaml` and `packages/create-app/template/docker/otel-collector-config.yaml` files with OTLP/HTTP, batch, and debug pipelines for traces, metrics, and logs.
4. Add a deterministic topology contract test under `scripts/__tests__/` covering environment parity, opt-in profile semantics, collector network/ports/mounts, and config parity.
5. Run the topology test, Compose configuration validation, and targeted create-app/template checks.

### Phase 2 — Operator documentation and full validation

6. Add `apps/docs/docs/framework/runtime/telemetry.mdx`, link it from `apps/docs/sidebars.ts`, and add a concise pointer from the structured-logging telemetry section.
7. Validate the docs route/build and run the configured repository validation sequence using one runner selected by the repository probe rules.
8. Update this spec's changelog with the implementation result and exact validation evidence; retain it in the pending/root specs directory until the feature is merged and deployed.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `docker-compose.fullapp.yml` | Modify | Pass telemetry env and add the opt-in collector. |
| `docker-compose.fullapp.traefik.yml` | Modify | Keep overlay app environment contract explicit and in parity. |
| `docker/otel-collector-config.yaml` | Add | Root diagnostic collector pipeline. |
| `packages/create-app/template/docker-compose.fullapp.yml` | Modify | Give generated standalone apps the same opt-in topology. |
| `packages/create-app/template/docker/otel-collector-config.yaml` | Add | Standalone diagnostic collector pipeline. |
| `scripts/__tests__/fullapp-compose-telemetry.test.mjs` | Add | Guard topology and template parity. |
| `apps/docs/docs/framework/runtime/telemetry.mdx` | Add | Document Docker and managed-backend enablement. |
| `apps/docs/docs/framework/runtime/logging.mdx` | Modify | Link logging users to telemetry deployment guidance. |
| `apps/docs/sidebars.ts` | Modify | Expose the new runtime documentation page. |
| `.ai/specs/2026-08-30-telemetry-docker-topology.md` | Add/Update | Source design and implementation evidence. |

## Final Compliance Report — 2026-08-30

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/telemetry/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| Root `AGENTS.md` | Preserve behavior unless the issue/spec requests a change. | Compliant | Compose merely forwards operator-provided values and the new collector service is profile-gated. |
| Root `AGENTS.md` | Ask before adding production dependencies. | Compliant | No dependency is added or moved; the existing OTEL packages stay optional. |
| Root `AGENTS.md` | App environment changes must stay aligned with the create-app template. | Compliant | Runtime environment pass-through and collector assets are implemented in root and standalone topology together. |
| `.ai/specs/AGENTS.md` | Non-trivial cross-file features require an implementation-accurate spec with tests. | Compliant | This spec defines exact files, failure modes, integration coverage, phasing, and rollback. |
| `packages/telemetry/AGENTS.md` | Host integration is default-unloaded and unset/noop is absolute off. | Compliant | Compose does not default the backend; host gating remains the activation authority. |
| `packages/telemetry/AGENTS.md` | OpenTelemetry packages stay optional and import only from `provider/otlp-provider.ts`. | Compliant | This topology spec does not change dependency placement or provider code. |
| `packages/telemetry/AGENTS.md` | Do not expose PII, credentials, request bodies, SQL parameters, or arbitrary thrown properties. | Compliant | Headers remain runtime secrets; the loader error retains only a safe message and `cause`; existing provider redaction remains intact. |
| `packages/create-app/AGENTS.md` | Keep app/template behavior aligned and validate standalone output. | Compliant | The template receives equivalent Compose/config changes and deterministic parity coverage. |
| `BACKWARD_COMPATIBILITY.md` | Do not remove or narrow protected public contracts. | Compliant | No protected type, function, import, route, event, schema, DI, feature, notification, CLI, or generated-file surface changes. |
| Root `AGENTS.md` data/security rules | Tenant scoping, zod input validation, encryption, mutation guards. | N/A | No data model, input, API, query, or mutation is introduced. |
| Root `AGENTS.md` UI/design-system rules | Use canonical UI primitives, i18n, and semantic tokens. | N/A | No application UI or user-facing runtime string is added. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Both are explicitly not applicable. |
| API contracts match UI/UX section | Pass | No API or application UI is introduced; operator behavior lives in Compose/docs. |
| Risks cover all write operations | Pass | There are no persistent writes; deployment, log exposure, drift, availability, and image-cost risks are covered. |
| Commands defined for all mutations | Pass | No business mutation or command exists. |
| Cache strategy covers all read APIs | Pass | No cache or read API exists. |
| Compatibility matches implementation plan | Pass | The plan preserves all protected surfaces and keeps the default Compose model unchanged. |
| Integration coverage maps to affected paths | Pass | All Compose variants, collector configs, template parity, and docs routing each have an explicit validation step. |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: Approved — ready for implementation.**

## Changelog

### 2026-08-30

- Added the focused deployment specification for issue #5783.
- Split generic missing-dependency runtime hardening into the companion `.ai/specs/2026-08-30-telemetry-otlp-missing-dependency-fail-fast.md` after a fresh-context cohesion review.
- Selected a profile-gated diagnostic collector with exact root/template parity, tests, docs, rollback, and compatibility coverage.

### Review — 2026-08-30

- **Reviewer**: Agent; the initial fresh-context review returned SPLIT, the runtime-hardening capability moved into a companion spec, and a second fresh-context review passed this topology scope as one cohesive deployment capability.
- **Security**: Passed — secrets remain runtime-only and no new listener is published to the host.
- **Performance**: Passed — telemetry remains off/unloaded by default and no new dependency or always-on service is added.
- **Cache**: Passed — no cache surface is involved.
- **Commands**: Passed — no business command or mutation is involved.
- **Risks**: Passed — debug-exporter exposure, drift, collector outage, and image cost are covered.
- **Verdict**: Approved.

### Implementation — 2026-08-31

- Implemented in PR #5799 on `feat/telemetry-docker-topology`; the runtime, deployment, documentation, regression-test, review, and run-ledger changes are complete at `b403e61f4c`.
- Forwarded the seven supported telemetry/OTLP variables through the root, Traefik-overlay, and create-app Compose definitions.
- Added the opt-in `telemetry` profile, pinned private collector service, and byte-identical root/template collector configurations without host-published ports or app startup coupling.
- Added the operator telemetry guide, sidebar entry, logging cross-link, source-contract tests, and disabled/profile Compose graph validation.
- Validation evidence: `yarn build:packages`, `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn build:app`, 97 telemetry tests, 47 combined Compose tests, 16 docs checks, and Docker Compose v5.4 config validation all passed. `yarn template:sync` reports only the pre-existing `modules.ts` drift. The local full `yarn test` gate is blocked solely by existing create-app live-harness host/sandbox failures; focused affected suites pass and the prior PR-head GitHub test check passed.
