---
title: "Browser error reporting requires client registration"
modules: ["telemetry", "ui"]
areas: ["architecture", "backend-ui", "testing"]
topics: ["error-reporting", "runtime-startup", "browser", "testing"]
---

# Browser error reporting requires client registration

Reviews of PRs #9934 and #9932 found that a handled address dictionary failure called the shared telemetry runtime, but the normal browser bootstrap never installed a reporter. Server-side `globalThis` registration cannot populate the browser's registry. Component tests that mocked the runtime getter concealed the missing production wiring.

Trace a client reporting call through the real app entry, registration, SDK and export boundary. Install a report-only callback from enabled `BrowserTelemetry` without pretending to supply a full server runtime. Retain calls during deferred SDK startup and isolate failed startup or reporting from localized feedback and readable fallback.

Regression coverage must mount the real browser entry and use the real shared registry. The address wiring test uses the real web SDK and substitutes only the exporter and unrelated automatic instrumentation registration. It fails with zero exported error spans against the unwired bootstrap and passes after registration, including a rejection during SDK startup. Keep disabled and failed-startup cases alongside it.
