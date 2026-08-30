# Telemetry Docker topology and OTLP bootstrap

Source doc: `.ai/specs/2026-08-30-telemetry-docker-topology.md`
Companion source doc: `.ai/specs/2026-08-30-telemetry-otlp-missing-dependency-fail-fast.md`

Engine: om-auto-create-pr (steps: 10, --loop: no)

## Goal

Make Open Mercato's optional OTLP telemetry mode deployable and diagnosable by wiring its runtime settings through supported Docker topologies, providing an opt-in local collector, and failing clearly when an explicitly selected OTLP backend lacks its optional runtime packages.

## Scope

- Preserve OpenTelemetry packages as optional dependencies.
- Replace the selected-OTLP console fallback with a boot-time error that preserves the original import failure as its cause.
- Forward the supported telemetry and OTLP environment variables through the root full-app Compose topology, its Traefik overlay, and the create-app template.
- Add profile-gated collector services and byte-identical collector examples to the root topology and create-app template without publishing collector ports.
- Add deterministic runtime and deployment contract tests.
- Document direct OTLP export, the local collector profile, endpoint semantics, headers, sampling, trust, validation, and troubleshooting.

## Non-goals

- Moving OpenTelemetry packages from `optionalDependencies` to regular production dependencies.
- Enabling telemetry or the collector by default.
- Adding a production observability backend, authentication proxy, TLS termination, or public collector ingress.
- Changing telemetry backend names, public package exports, database structures, or API routes.
- Adding rendered application UI.

## Implementation Plan

### Phase 1: Fail-fast OTLP bootstrap

1. Replace console fallback with an actionable startup error for explicitly selected OTLP backends while retaining the import error as `cause`.
2. Add deterministic unit coverage for success, failure, no-fallback, disabled telemetry, and retry behavior.
3. Run the telemetry package's focused test, type, and build checks and re-read the runtime diff for compatibility.

### Phase 2: Docker topology and collector example

1. Forward the supported telemetry and OTLP variables through all three app Compose definitions with consistent defaults.
2. Add an opt-in, profile-gated collector service and byte-identical root/template collector configurations without host port publication.
3. Add deterministic source-contract coverage for environment parity, profile gating, endpoint semantics, private ports, and config parity.
4. Validate the root and create-app Compose graphs in disabled and telemetry-profile modes.

### Phase 3: Operator documentation and delivery gates

1. Add the runtime telemetry guide, sidebar entry, and logging cross-link.
2. Run focused documentation and topology checks and audit the combined diff against both approved specs.
3. Run the configured full validation gate, authoritative PR review with autofix, and final delivery checks.

## Risks

- Compose interpolation or overlay replacement rules could produce topology-specific drift; parsed contract tests and `docker compose config` checks cover every supported file combination.
- Dynamic import failures vary by package manager and install mode; tests assert a stable operator-facing message and preserved cause rather than package-manager-specific error text.
- Collector images and OTLP endpoint semantics can drift; the example pins an image version and documents that application containers use the collector service name rather than `localhost`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fail-fast OTLP bootstrap

- [x] 1.1 Replace selected-OTLP fallback with an actionable startup error — 95e7942f6c
- [x] 1.2 Add deterministic OTLP bootstrap unit coverage — 95e7942f6c
- [x] 1.3 Run focused telemetry validation and compatibility review — 95e7942f6c

### Phase 2: Docker topology and collector example

- [ ] 2.1 Forward telemetry and OTLP variables through all supported Compose definitions
- [ ] 2.2 Add profile-gated collector services and byte-identical example configurations
- [ ] 2.3 Add deterministic Docker topology contract coverage
- [ ] 2.4 Validate disabled and telemetry-profile Compose graphs

### Phase 3: Operator documentation and delivery gates

- [ ] 3.1 Add the runtime telemetry guide, navigation entry, and logging cross-link
- [ ] 3.2 Run focused documentation/topology checks and audit both-spec coverage
- [ ] 3.3 Run the full validation, review, and final delivery gates
