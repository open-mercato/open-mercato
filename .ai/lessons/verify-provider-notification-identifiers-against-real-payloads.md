---
title: "Verify provider notification identifiers against real payloads before designing locators"
modules: ["payment_gateways","gateway_tpay"]
areas: ["integration"]
topics: ["webhooks","data-scoping","provider-lifecycle"]
---

# Verify provider notification identifiers against real payloads before designing locators

**Context**: The Tpay gateway stored the Open API `transactionId` as `providerSessionId` and the webhook handler read the notification `tr_id` as the session id hint.

**Problem**: In real Tpay notifications `tr_id` is the transaction title (`TR-…`), not the Open API `transactionId`. The locator never matched, so notifications could not be correlated with the stored transaction even though the signature verified.

**Rule**: Before designing a webhook locator, capture a real (sandbox) notification and map every identifier field to the value the create/status API returns. Correlate on a value you control and send to the provider (for Tpay: `tr_crc`, populated from our `hiddenDescription` = payment id), and treat provider-generated ids as secondary hints only after confirming they match what you persisted.

**Applies to**: provider webhook handlers in gateway packages, `readSessionIdHint`/`readPaymentIdHint` implementations, and any `providerSessionId` mapping.
