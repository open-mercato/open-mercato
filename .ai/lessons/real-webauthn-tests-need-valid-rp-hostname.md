---
title: "Real WebAuthn tests need a valid relying-party hostname"
modules: ["security"]
areas: ["testing", "integration"]
topics: ["webauthn", "testing"]
---

# Real WebAuthn tests need a valid relying-party hostname

**Context:** The managed ephemeral CLI exposes `127.0.0.1`, which works for ordinary browser and API tests. Chromium rejects that IP address as a WebAuthn relying-party ID even with a virtual authenticator.

**Rule:** Use the same loopback server through `localhost` for the browser and every registration/assertion API call, including its auth cookie. Retain configured remote hostnames. Never weaken the production RP/origin checks, disable browser security, or replace signed ceremonies with fabricated credentials to make the test pass.

- 2026-10-01 · security (#6800): real registration failed with `SecurityError: This is an invalid domain` on the IP endpoint; the unchanged production verifier accepted the native UI ceremony through `localhost`.
