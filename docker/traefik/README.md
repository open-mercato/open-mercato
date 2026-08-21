# Traefik — Custom Domain Reverse Proxy

This directory contains Traefik configuration that fronts the Mercato app for
**Phase 3** of the portal custom-domain spec
(`.ai/specs/implemented/2026-04-08-portal-custom-domain-routing.md`). Traefik terminates
TLS for both the platform domain and any verified customer-controlled
hostname, gates each request through the app's domain-check endpoint, and
issues Let's Encrypt certificates on demand via TLS-ALPN-01.

## Files

| File | Purpose |
|------|---------|
| `traefik.yml` | Static config: entrypoints (`web`/`websecure`), HTTP→HTTPS redirect, ACME resolver (Let's Encrypt + TLS-ALPN-01), Docker provider. |
| `dynamic.example.yml` | Reference dynamic config for non-Docker deployments. Replace placeholders before mounting at `/etc/traefik/dynamic.yml`. |

The bundled Traefik service and the routers/services/middlewares it reads
live in **`docker-compose.fullapp.traefik.yml`** — an **opt-in overlay**.
The base compose files (`docker-compose.fullapp.yml` / `…dev.yml`) ship
without Traefik so the stack runs cleanly behind an external reverse proxy
(Dokploy, Caddy, nginx, Cloudflare Tunnel, ELB, …) without port or label
conflicts. Skip the overlay when something upstream already terminates TLS
and replicate the routers + ForwardAuth middleware in *that* proxy's config.

## When to use the bundled Traefik

| Scenario | Bundled Traefik (this overlay)? |
|----------|--------------------------------|
| Self-hosted VPS, you own port 80/443 | Yes |
| Behind Dokploy / Coolify / managed PaaS that already runs Traefik | **No** — register the routers + ForwardAuth middleware in the PaaS Traefik instead |
| Cloudflare Tunnel / ngrok / external L7 load balancer terminates TLS | No |
| Local dev without TLS (use `X-Force-Host` test bypass) | No |

## Usage with the overlay

```bash
# Production:
docker compose -f docker-compose.fullapp.yml \
  -f docker-compose.fullapp.traefik.yml up -d

# Dev (layer the dev overlay so ACME defaults to LE staging):
docker compose -f docker-compose.fullapp.dev.yml \
  -f docker-compose.fullapp.traefik.yml \
  -f docker-compose.fullapp.traefik.dev.yml up --build
```

`docker-compose.fullapp.traefik.yml` defaults `TRAEFIK_CA_SERVER` to LE
production. `docker-compose.fullapp.traefik.dev.yml` is a tiny dev-only overlay
that flips that default to LE staging so iteration doesn't burn the production
rate limits. Drop the dev overlay from the `-f` chain (or export
`TRAEFIK_CA_SERVER` explicitly) to opt back into the production directory.

Routers/services/middlewares are declared as **labels on the `app` service**
inside the overlay so compose-level `${ENV}` substitution can inject
`DOMAIN_CHECK_SECRET` and `PLATFORM_PRIMARY_HOST`.

## Required environment

| Variable | Where it's read | Notes |
|----------|-----------------|-------|
| `ACME_EMAIL` | Traefik | Let's Encrypt contact address. |
| `DOMAIN_CHECK_SECRET` | Traefik labels + app | Mandatory shared secret for `/api/customer_accounts/domain-check`. |
| `DOMAIN_RESOLVE_SECRET` | App | Mandatory shared secret for the middleware's `domain-resolve` calls. |
| `PLATFORM_PRIMARY_HOST` | Compose labels | Primary platform host (e.g., `openmercato.com`); excluded from the `domain-check` middleware. |
| `INTERNAL_APP_ORIGIN` | App middleware | Defaults to `http://app:3000` inside the docker network. |
| `TRAEFIK_CA_SERVER` | Traefik | The base Traefik overlay defaults to LE **production**. Layer `docker-compose.fullapp.traefik.dev.yml` (or export the variable) to flip to LE **staging** for safe dev iteration. |
| `TRAEFIK_HTTP_PORT` / `TRAEFIK_HTTPS_PORT` | Compose | Host port mapping; defaults to `80`/`443`. |
| `TRAEFIK_DASHBOARD_PORT` | Compose | Exposes Traefik's `8080` API port locally. **NOT published by default** — uncomment the `ports` entry inside `docker-compose.fullapp.traefik.yml` and set this variable only when you also restrict access via firewall/VPN. |

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
- **⚠️ Cert issuance is not gated by Traefik — production blocker without mitigation.**
  Traefik (unlike Caddy's `on_demand_tls.ask`) does not expose a hook to gate
  ACME issuance itself; ForwardAuth only gates request forwarding. The
  catch-all `HostRegexp({any:.+})` router means Traefik will attempt to issue
  a cert for any TLS SNI an attacker presents — TLS handshake is upstream of
  the HTTP routing layer where `domain-check` runs. An attacker probing
  random hostnames can rapidly exhaust the Let's Encrypt per-account rate
  limit (50 certs / registered-domain / week; 5 failed-validations / host /
  hour). **You MUST mitigate this before going to production. Pick one:**
    - Put Traefik behind an upstream proxy (Cloudflare in proxy mode) that
      drops unknown hosts before they reach Traefik.
    - Pre-restrict `domains:` on the ACME resolver to a manually allowlisted
      parent zone (re-deploy Traefik when the allowlist changes).
    - Use a Traefik plugin that hooks into the ACME flow and consults the
      `domain-check` endpoint before issuance.
    - Run Traefik behind a firewall/WAF that blocks SNI for unmapped hosts.

  The `DOMAIN_CHECK_SECRET` ensures the verification endpoint itself cannot
  be probed, but it does not stop ACME issuance attempts.
- **Dev vs prod CA.** The base Traefik overlay (`docker-compose.fullapp.traefik.yml`)
  defaults `TRAEFIK_CA_SERVER` to LE production so prod invocations issue real
  certs. Dev workflows layer `docker-compose.fullapp.traefik.dev.yml` on top to
  flip the default to LE **staging** (untrusted certs, much higher rate limits)
  so iteration does not consume the production quota. Drop the dev overlay from
  the `-f` chain to opt back into LE production.
- **Dashboard.** The Traefik dashboard exposes routers/services/cert
  metadata. The Traefik overlay (`docker-compose.fullapp.traefik.yml`) does
  **NOT** publish the dashboard port by default in either prod or dev mode —
  uncomment the `- "${TRAEFIK_DASHBOARD_PORT}:8080"` entry inside that file
  only when you have firewall/VPN restrictions in place.
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
