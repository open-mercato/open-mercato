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
live in **`starters/docker/compose.fullapp.traefik.yml`** — an **opt-in overlay**.
The base compose files (`starters/docker/compose.fullapp.yml` / `…dev.yml`) ship
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

Use **Docker Compose 2.24.4 or newer** (`docker compose version`). The overlay
uses Compose's `!reset` tag to remove inherited host ports; an ordinary empty
`ports` list does not remove them during a merge.

```bash
# Production:
docker compose --project-directory . \
  -f starters/docker/compose.fullapp.yml \
  -f starters/docker/compose.fullapp.traefik.yml up -d

# Dev (layer the dev overlay so ACME defaults to LE staging):
docker compose --project-directory . \
  -f starters/docker/compose.fullapp.dev.yml \
  -f starters/docker/compose.fullapp.traefik.yml \
  -f starters/docker/compose.fullapp.traefik.dev.yml up --build
```

`starters/docker/compose.fullapp.traefik.yml` defaults `TRAEFIK_CA_SERVER` to LE
production. `starters/docker/compose.fullapp.traefik.dev.yml` is a tiny dev-only overlay
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
| `TRAEFIK_CA_SERVER` | Traefik | The base Traefik overlay defaults to LE **production**. Layer `starters/docker/compose.fullapp.traefik.dev.yml` (or export the variable) to flip to LE **staging** for safe dev iteration. |
| `TRAEFIK_HTTP_PORT` / `TRAEFIK_HTTPS_PORT` | Compose | Host port mapping; defaults to `80`/`443`. |
| `TRAEFIK_DASHBOARD_PORT` | Compose | Exposes Traefik's `8080` API port locally. **NOT published by default** — uncomment the `ports` entry inside `starters/docker/compose.fullapp.traefik.yml` and set this variable only when you also restrict access via firewall/VPN. |

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

## Private application ports and migration

With the bundled Traefik overlay, neither `app` nor the optional
`documents-collab` service publishes host ports. Traefik reaches the app on
the shared Docker network at `app:${CONTAINER_PORT:-3000}` (port 3000 in dev).
`APP_PORT` no longer publishes a port when this overlay is present. The dev
splash port is also private. Public application traffic enters on Traefik's
HTTP/HTTPS ports (80/443 by default).

After upgrading, recreate affected containers with the same Compose files and
profiles used for deployment (`up -d`); a container restart alone does not
change its port bindings. Move external health probes from `:3000` to the
public HTTPS hostname. The app's existing container-local healthcheck remains
available. Check `docker compose ... config` before deploying and verify the
bindings of the recreated containers afterwards, including any local overrides.
The legacy root `docker-compose.fullapp*.yml` invocation has the same behavior.

Deployments using an external proxy or deliberate direct access can continue
to **omit the Traefik overlay**: the base files retain their `APP_PORT` mapping.
Restrict that listener to the intended proxy or operator network and reproduce
the TLS and ForwardAuth controls in the external proxy. A proxy attached to
the Compose network can use `app:3000` without any host publication.

For a host-local proxy or temporary operator diagnostics with bundled Traefik,
add this local file **last** in the `-f` chain:

```yaml
# compose.loopback.local.yml
services:
  app:
    ports: !override
      - "127.0.0.1:${APP_PORT:-3000}:${CONTAINER_PORT:-3000}"
```

For dev, use container port `3000`. Access the diagnostic listener over an SSH
tunnel if needed. This explicit listener bypasses the edge controls, so keep
it on loopback. Use a private interface instead only when the deployment
intentionally requires it and restrict access to that interface.

## Documents collaboration over WSS

The `documents-collab` profile stays opt-in, and port 4101 stays internal with
this overlay even when the profile is enabled. Production browsers need a
TLS WebSocket proxy. For example, add a final local overlay routing a dedicated
hostname to the sidecar on the same network:

```yaml
# compose.collab.local.yml
services:
  documents-collab:
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=mercato-network-${DEPLOY_ENV:-local}-v2"
      - "traefik.http.routers.documents-collab.rule=Host(`collab.example.com`)"
      - "traefik.http.routers.documents-collab.priority=110"
      - "traefik.http.routers.documents-collab.entrypoints=websecure"
      - "traefik.http.routers.documents-collab.tls=true"
      - "traefik.http.routers.documents-collab.tls.certresolver=letsencrypt"
      - "traefik.http.routers.documents-collab.service=documents-collab"
      - "traefik.http.services.documents-collab.loadbalancer.server.port=${DOCUMENTS_COLLAB_PORT:-4101}"
```

Replace `collab.example.com` with an operator-controlled DNS hostname pointing
to Traefik. Set `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL=wss://collab.example.com`
**before rebuilding the app image**, set a strong shared
`DOCUMENTS_COLLAB_JWT_SECRET_V2`, and set
`DOCUMENTS_COLLAB_ALLOWED_ORIGINS` to the exact public HTTPS app origins. Start
with `--profile documents-collab` and the final local overlay. Traefik handles
the WebSocket upgrade; the sidecar still enforces its own token and Origin
checks. These checks are separate from the app's custom-domain ForwardAuth
gate. An external host proxy can instead use a final loopback-only mapping on
`documents-collab`, such as `127.0.0.1:4101:4101`, and terminate WSS there.

## Deployment checks

Use the deployment's full `docker compose --project-directory . -f ...` chain
for each Compose command:

1. Inspect `config --format json`: `app.ports` and `documents-collab.ports`
   must be absent or empty with bundled Traefik, unless a deliberate private
   override is present. `traefik.ports` must contain the intended public edge
   ports. `docker compose ... port app 3000` must report no published mapping
   (substitute the configured container port).
2. From another machine, run `curl -I http://<platform-host>/` and confirm an
   HTTPS redirect, then request `https://<platform-host>/` and a verified
   customer hostname. Confirm the customer route uses ForwardAuth in the
   Traefik access logs; an unmapped hostname must be rejected. Use a trusted
   test certificate or staging ACME setup for the negative-host check.
3. From that machine, `curl --connect-timeout 5 http://<server-public-ip>:3000/`
   must fail to connect; repeat for any former `APP_PORT` and collaboration
   port 4101. On the host, inspect the running containers' bindings with
   `docker inspect` to rule out a firewall merely hiding a remaining publication.
4. Successful HTTPS requests prove Traefik can reach the app internally.
   With collaboration enabled, confirm a browser connects over WSS and two
   authenticated editors synchronize; no public `:4101` listener is needed.

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
- **Dev vs prod CA.** The base Traefik overlay (`starters/docker/compose.fullapp.traefik.yml`)
  defaults `TRAEFIK_CA_SERVER` to LE production so prod invocations issue real
  certs. Dev workflows layer `starters/docker/compose.fullapp.traefik.dev.yml` on top to
  flip the default to LE **staging** (untrusted certs, much higher rate limits)
  so iteration does not consume the production quota. Drop the dev overlay from
  the `-f` chain to opt back into LE production.
- **Dashboard.** The Traefik dashboard exposes routers/services/cert
  metadata. The Traefik overlay (`starters/docker/compose.fullapp.traefik.yml`) does
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
