---
title: "Provider sandboxes may sign notifications with a separate CA"
modules: ["payment_gateways","gateway_tpay"]
areas: ["integration"]
topics: ["network-security","webhooks"]
---

# Provider sandboxes may sign notifications with a separate CA

**Context**: Tpay notifications carry a detached JWS whose `x5u` header points to the signing certificate. Verification was built against the production URL and CA.

**Problem**: The sandbox signs with `https://secure.sandbox.tpay.com/x509/notifications-jws.pem` issued by `KIP SA Sandbox CA`, while production uses `secure.tpay.com` under `KIP SA HA CA` (both chain to `KIP SA Root CA`). Assuming production values rejects every sandbox notification, and loosening the check to accept any `x5u` would let an attacker supply their own certificate.

**Rule**: Pin the trust anchor and the exact `x5u` URL per environment (sandbox vs production) in the provider package, select them from the configured environment, and never derive trust from the URL or certificate sent in the notification. Verify both environments against real signed payloads.

**Applies to**: JWS/signature verification in gateway, carrier, and other provider webhook receivers that fetch signing certificates.
