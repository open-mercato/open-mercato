# Integration Feasibility Analyses

Per-integration feasibility analyses evaluating how well external services map to Open Mercato's spec-defined adapter contracts. Each analysis identifies what works, what's missing, what's difficult, and provides effort estimates.

## Analyses

| # | Integration | Related Spec | Verdict | Link |
|---|-------------|-------------|---------|------|
| ANALYSIS-001 | Slack | [SPEC-045](../SPEC-045-2026-02-24-integration-marketplace.md) | Partial — core notifications ready; interactive features (commands, modals, events) require new patterns | [View](./ANALYSIS-001-slack-integration-feasibility.md) |
| ANALYSIS-002 | OroCRM | [SPEC-045](../SPEC-045-2026-02-24-integration-marketplace.md), [SPEC-045b](../SPEC-045b-data-sync-hub.md) | Feasible with constraints (~70-75% coverage). Import-first, 5-7 weeks effort. No webhooks, rate limits, complex customer model. | [View](./ANALYSIS-002-orocrm-integration.md) |
| ANALYSIS-003 | Amazon.de (SP-API) | [SPEC-045](../SPEC-045-2026-02-24-integration-marketplace.md), [SPEC-045b](../SPEC-045b-data-sync-hub.md) | Feasible with significant effort (~70% coverage). Auth complexity (LWA+SigV4+RDT), no inventory module, AWS-only notifications, Product Type Definition complexity. | [View](./ANALYSIS-003-amazon-de-integration.md) |
| ANALYSIS-044 | Przelewy24 | [SPEC-044](../SPEC-044-2026-02-24-payment-gateway-integrations.md) | Feasible (~70% clean fit, 30% no-op stubs) | [View](./ANALYSIS-044-przelewy24-integration-feasibility.md) |
| ANALYSIS-045d | WhatsApp | [SPEC-045d](../SPEC-045d-communication-notification-hubs.md) | Partial (~60% covered by current spec). Template management, conversation windows, and consent tracking are critical gaps. ~10% features impossible (no API). | [View](./ANALYSIS-045d-whatsapp-integration.md) |
| ANALYSIS-004 | BambooHR | [SPEC-045](../SPEC-045-2026-02-24-integration-marketplace.md), [SPEC-045b](../SPEC-045b-data-sync-hub.md) | HIGH feasibility (~70-80% coverage). Strong API for employees, time off, benefits, ATS, goals. Missing: performance reviews, onboarding, payroll. Main prerequisite: HR module. | [View](./ANALYSIS-004-bamboohr-integration.md) |
| ANALYSIS-005 | Shopify | [SPEC-045](../SPEC-045-2026-02-24-integration-marketplace.md), [SPEC-045b](../SPEC-045b-data-sync-hub.md), [SPEC-044](../SPEC-044-2026-02-24-payment-gateway-integrations.md) | GO (~80% coverage). Products, customers, orders map cleanly. Bundle pattern fits perfectly. Critical gap: no inventory module (multi-location). Payment gateway sync blocked (partner approval). Smart Collections, Shopify Markets partial. | [View](./ANALYSIS-005-2026-02-24-shopify-integration.md) |
