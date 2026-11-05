# External Agent Authentication (`auth.md`)

How an EXTERNAL agent authenticates to Open Mercato and obtains a scoped, revocable
token. Internal in-process agents (the `INVOKE_AGENT` step) use no network auth and
are out of scope here — see the agent identity spec
(`.ai/specs/enterprise/agent-orchestrator/next/2026-06-19-agent-identity-and-on-behalf-of.md`).

There are two non-interactive credential paths. Both mint the SAME kind of token
(audience `agent`, short-lived, bound to an `AgentDelegationGrant`, revoked per
request) through one shared mint core — there is no parallel token system. The
interactive password/SSO login flow is never exposed to a `kind='agent'` principal.

## Discovery (`GET /api/agent_orchestrator/identity/well-known`)

Public, read-only, secret-free. Advertises where to authenticate and what the
platform supports:

```jsonc
{
  "issuer": "open-mercato",
  "token_endpoint": "/api/agent_orchestrator/identity/token",
  "agent_auth_endpoint": "/api/agent_orchestrator/identity/agent/auth",
  "grant_types_supported": [
    "client_credentials",
    "urn:ietf:params:oauth:grant-type:jwt-bearer"
  ],
  "agent_assertion_audience": "open-mercato:agent-auth",
  "token_audience": "agent",
  "token_endpoint_auth_methods_supported": ["client_secret_post", "private_key_jwt"]
}
```

No issuer keys / JWKS are exposed: the platform validates an external assertion
server-side against its trusted-issuer registry, so there is no client-fetched
verification material to leak.

## Path A — OAuth client-credentials (now)

`POST /api/agent_orchestrator/identity/token` (RFC 6749 §4.4). A pre-provisioned
external `AgentPrincipal` (`credentialMode='oauth_client'`) presents its
`client_id` + `client_secret`; the platform verifies the secret (bcrypt, via the
`api_keys` module) against an active `AgentDelegationGrant` and mints a scoped
token. Used when an operator provisioned the credential ahead of time.

## Path B — ID-JAG / auth.md self-registration (this phase, additive)

`POST /api/agent_orchestrator/identity/agent/auth` (RFC 7523 JWT-bearer). For
onboarding external agents AT SCALE without pre-provisioning a secret: the agent
presents an issuer-signed identity assertion (an ID-JAG). The platform:

1. **Validates the assertion server-side.** The `iss` claim selects the issuer's
   verification secret from the trusted-issuer registry (`AGENT_ID_JAG_ISSUERS`
   env — never client input). The assertion's signature, expiry, and `aud` (which
   MUST equal `agent_assertion_audience`) are checked with the shared `verifyJwt`
   HS256 primitive — no hand-rolled crypto. A forged, expired, or wrong-audience
   assertion is rejected with a single minimal `401 invalid_grant` (no info leak;
   the raw assertion is never logged).
2. **Idempotently onboards a scoped principal.** Provisions an `AgentPrincipal`
   with `credentialMode='authmd'` (idempotent on `(org, agent_definition_id)`),
   whose scoped least-privilege `Role` grants exactly the assertion's `scopes`.
3. **Find-or-creates the delegation grant.** An `AgentDelegationGrant` keyed on
   `(org, principal, issuer, subject)` over live rows, populating the
   `issuer`/`subject`/`audience` columns. Re-presenting the same issuer+subject
   resolves the existing active grant — no duplicates. A revoked grant is NOT
   resurrected (revocation is durable).
4. **Mints a scoped token** via the same `mintAgentTokenForGrant` core Path A
   uses, so the token is identically scoped, revocable, and audited.

### Assertion claims

| Claim | Meaning |
|-------|---------|
| `iss` | Trusted issuer id; selects the server-side verification key. |
| `sub` | Stable external subject; the onboarding idempotency key (with `iss`). |
| `aud` | MUST equal the platform's `agent_assertion_audience`. |
| `tenant_id` / `org_id` | Tenant/org the issuer provisions into (issuer may be org-pinned). |
| `agent_definition_id` | The agent definition the external agent maps to. |
| `delegator_user_id` | Optional human the agent acts on behalf of (→ on-behalf-of audit). |
| `scopes` | Requested `<capability>:<action>` scopes (the grant + scoped role carry these). |
| `display_name` | Optional name stamped on the provisioned agent `User`. |

### Configuration

`AGENT_ID_JAG_ISSUERS` — JSON array of trusted issuers (server-side only):

```json
[{ "issuer": "https://idp.example.com", "secret": "<shared-hs256-secret>", "allowedOrganizationIds": ["<org-uuid>"] }]
```

`AGENT_ID_JAG_AUDIENCE` — the assertion audience (default `open-mercato:agent-auth`).

When `AGENT_ID_JAG_ISSUERS` is unset/malformed the endpoint **fails closed** —
every assertion is rejected rather than trusting an unconfigured issuer.

## Invariants (identical for both paths)

- Tenant/org/scope are SERVER-DERIVED (from the resolved principal + grant for
  Path A; from the SIGNED assertion + grant for Path B). A caller can never widen
  tenant or capability.
- The token's audience is `agent`, so it can never be replayed as a staff or
  customer session.
- Revocation is immediate: revoking the `AgentDelegationGrant` denies every minted
  token on its NEXT request (`POST /identity/grants/:id/revoke`).
- The no-bypass invariant + structural propose-only hold: an ID-JAG-onboarded
  agent is still a propose-only `kind='agent'` principal whose writes must flow
  through the audited Command path (the flush-time write-interceptor fails closed
  otherwise).
