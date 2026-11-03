---
title: "Webhook body-limit sweeps must include source-specific receivers"
modules: ["webhooks","payment_gateways","shipping_carriers","communication_channels","inbox_ops"]
areas: ["integration","testing","architecture"]
topics: ["webhooks","network-security","testing"]
---

# Webhook body-limit sweeps must include source-specific receivers

**Context**: A generic provider-route sweep missed the dedicated Gmail and source-specific InboxOps receivers.

**Rule**: Enumerate every public webhook path and preserve each source's effective limit in code, tests, specs, and ingress documentation.

**Applies to**: generic webhooks, payment and shipping providers, communication-channel provider routes, Gmail Pub/Sub, InboxOps, and future public webhook receivers.
