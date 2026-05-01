# Traefik — Custom Domain Reverse Proxy

This directory contains Traefik configuration that fronts the Mercato app for
**Phase 3** of the portal custom-domain spec
(`.ai/specs/2026-04-08-portal-custom-domain-routing.md`). Traefik terminates
TLS for both the platform domain and any verified customer-controlled
hostname, gates each request through the app's domain-check endpoint, and
issues Let's Encrypt certificates on demand via TLS-ALPN-01.

## Files

| File | Purpose |
|------|---------|
| `traefik.yml` | Static config: entrypoints (`web`/`websecure`), HTTP→HTTPS redirect, ACME resolver (Let's Encrypt + TLS-ALPN-01), Docker provider. |
| `dynamic.example.yml` | Reference dynamic config for non-Docker deployments. Replace placeholders before mounting at `/etc/traefik/dynamic.yml`. |

In Docker, routers/services/middlewares are declared as **labels** on the
`app` service in `docker-compose.fullapp.yml` and `docker-compose.fullapp.dev.yml`,
which lets compose-level `${ENV}` substitution inject `DOMAIN_CHECK_SECRET`
and `PLATFORM_PRIMARY_HOST`.

## Required environment

| Variable | Where it's read | Notes |
|----------|-----------------|-------|
| `ACME_EMAIL` | Traefik | Let's Encrypt contact address. |
| `DOMAIN_CHECK_SECRET` | Traefik labels + app | Mandatory shared secret for `/api/customer_accounts/domain-check`. |
| `DOMAIN_RESOLVE_SECRET` | App | Mandatory shared secret for the middleware's `domain-resolve` calls. |
| `PLATFORM_PRIMARY_HOST` | Compose labels | Primary platform host (e.g., `openmercato.com`); excluded from the `domain-check` middleware. |
| `INTERNAL_APP_ORIGIN` | App middleware | Defaults to `http://app:3000` inside the docker network. |
| `TRAEFIK_CA_SERVER` | Traefik | Defaults to LE production. The dev compose defaults to LE staging — flip to prod (`https://acme-v02.api.letsencrypt.org/directory`) when ready. |
| `TRAEFIK_HTTP_PORT` / `TRAEFIK_HTTPS_PORT` | Compose | Host port mapping; defaults to `80`/`443`. |
| `TRAEFIK_DASHBOARD_PORT` | Compose | Exposes Traefik's `8080` API port locally; defaults to `8081`. |

## Request flow

```
Browser → https://shop.acme.com
   ↓
Traefik (catch-all router, priority 1)
   ↓
TLS handshake: certificate issued on demand via TLS-ALPN-01 (Let's Encrypt)
   ↓
Middleware "inject-domain-check-secret" — adds X-Domain-Check-Secret to request
   ↓
Middleware "domain-check" (ForwardAuth):
   GET http://app:3000/api/customer_accounts/domain-check
       headers: X-Domain-Check-Secret, X-Forwarded-Host: shop.acme.com
       ↓
   App: resolveByHostname → status active|verified → 200 OK
                          → otherwise → 404
   ↓
On 200 → request forwarded to app-upstream (http://app:3000) with original Host
On 404 → request blocked at the edge
```

The platform router (`Host(\`${PLATFORM_PRIMARY_HOST}\`)`, priority 100) wins
over the catch-all for known operator hostnames and skips the domain-check
middleware entirely.

## Operating notes

- **Storage volume.** ACME state lives in the named volume `mercato-traefik-acme-${DEPLOY_ENV}`.
  Do not delete it during normal restarts — re-issuing certs after losing the
  volume can rapidly hit Let's Encrypt rate limits. Back it up with the rest
  of your platform state.
- **Cert issuance is not gated by Traefik.** Traefik (unlike Caddy's
  `on_demand_tls.ask`) does not expose a hook to gate ACME issuance itself;
  ForwardAuth only gates request forwarding. An attacker probing many random
  hostnames can still trigger ACME requests and risk hitting Let's Encrypt's
  per-account rate limit. Production deployments should consider:
    - Putting Traefik behind an upstream proxy (Cloudflare in proxy mode)
      that drops unknown hosts before they reach Traefik, or
    - Pre-restricting `domains:` on the ACME resolver to a manually
      allowlisted parent zone, or
    - Using a Traefik plugin that hooks into the ACME flow.
  The `DOMAIN_CHECK_SECRET` ensures the verification endpoint cannot be probed
  directly, but it does not stop ACME issuance attempts.
- **Dev vs prod CA.** The dev compose file defaults `TRAEFIK_CA_SERVER` to the
  Let's Encrypt **staging** directory (untrusted certs, much higher rate
  limits) so iteration does not consume the production quota. Production
  deployments must override this to the real LE directory.
- **Dashboard.** The Traefik API is exposed on the host port set by
  `TRAEFIK_DASHBOARD_PORT` (default `8081`). The dashboard is NOT secured
  beyond being unbound to a public hostname; restrict access via firewall
  rules or expose it only on a management network.
- **Trust boundaries.** `trustforwardheader=false` is intentional — Traefik is
  the edge and must not trust client-supplied `X-Forwarded-*` headers. If you
  put Traefik behind another trusted proxy, flip this to `true` and configure
  the upstream proxy's IP in `forwardedHeaders.trustedIPs`.

## Why labels instead of `dynamic.yml`?

Traefik's file provider does **not** interpolate environment variables.
Hardcoding `DOMAIN_CHECK_SECRET` and `PLATFORM_PRIMARY_HOST` into a tracked
YAML file would either leak secrets or force every operator to maintain a
local fork. Using Docker labels lets compose-level env substitution wire the
right values at start-up without surfacing them in the repository.

For non-Docker deployments (Kubernetes, bare metal Traefik, etc.), use
`dynamic.example.yml` as a starting point and inject secrets via your
orchestrator's templating mechanism.
