# Cloudflare Zero Trust access for Enterprise Edition

Extends: .ai/specs/enterprise/implemented/SPEC-ENT-004-2026-02-19-sso-directory-sync.md
Extends: .ai/specs/enterprise/2026-11-15-sso-authority-ceiling.md
Extends: .ai/specs/implemented/SPEC-060-2026-03-04-customer-identity-portal-auth.md
Extends: .ai/specs/implemented/2026-04-08-portal-custom-domain-routing.md
Extends: .ai/specs/2026-11-09-portal-canonical-scope-compatibility.md

## 📝 TLDR

Enterprise deployment operators would be able to require Cloudflare Access independently for the staff backend, application frontend, and customer portal. On a protected staff backend, an optional Enterprise SSO handoff would let an eligible staff member enter Open Mercato without entering separate Open Mercato credentials. Cloudflare controls admission to the selected surfaces. Open Mercato controls staff and customer sessions, permissions, and tenant scope.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Why | Confirm? |
|---|---|---|---|---|
| Q1 | Should access enforcement and staff sign-in ship independently? | One design with two releases. Ship the three-surface gate first. The optional staff handoff depends on that gate. | Operators gain perimeter protection while the federation path is validated. | Reversible |
| Q2 | Who configures protection, and what is selected by default? | Deployment operators choose exact surface hostnames and audiences. All three surfaces and automatic sign-in start off. | An operator can protect staff without affecting shoppers or customers on other hosts. | Reversible |
| Q3 | How should Cloudflare feed staff sign-in? | Use Cloudflare Access for SaaS as the Enterprise SSO OIDC provider. Start with existing authorized staff. | Reuses the staff session, account linking, and authority checks. The compatibility test gates enablement. | Reversible |

## 📝 Overview

The target is an Enterprise deployment with an operator-managed Cloudflare Zero Trust account and control of its ingress and DNS. An operator may enable any subset of the three spaces, including staff only, frontend only, staff and frontend together, or all three. Portal protection is its own choice. A protected portal still asks a customer to sign in using the existing portal flow where required.

Grafana documents optional automatic login for one configured OAuth provider, and Argo CD retains an application RBAC policy alongside OIDC. Apply both patterns by selecting one explicit staff SSO configuration per staff host and preserving Open Mercato authorization. Cloudflare documents self-hosted application assertions and a separate authorization-code OIDC provider. [Grafana automatic OAuth login](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/#automatic-oauth-login), [Argo CD RBAC](https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/), [Cloudflare application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/), [Cloudflare generic OIDC application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/saas-apps/generic-oidc-saas/).

## 📝 Problem Statement

The staff backend and general frontend share an application origin. Portal pages are dispatched through the frontend and can also be rewritten from custom hostnames. The Next.js proxy matcher skips API routes, whose tenant and authorization logic executes separately. Applying a policy to a page prefix alone therefore does not establish a boundary around the space's API, downloads, or event stream. Staff SSO already exchanges OIDC codes and issues scoped staff sessions. Customer accounts use their own identity and session model. [Next.js proxy](../../../apps/mercato/src/proxy.ts), [API dispatcher](../../../apps/mercato/src/app/api/%5B...slug%5D/route.ts), [Enterprise SSO service](../../../packages/enterprise/src/modules/sso/services/ssoService.ts), [Customer Accounts guide](../../../packages/core/src/modules/customer_accounts/AGENTS.md).

## 📝 Proposed Solution

Ship a documented Enterprise ingress profile for exact hostnames, with a private upstream and origin-side Access verification. Build on the existing private-origin Traefik deployment as the reference topology. Keep Cloudflare policies, identity providers, and device requirements operator-managed. Offer an optional staff-only OIDC handoff from a protected staff host to a single active Enterprise SSO configuration. Google Workspace is the reference identity provider configured in Cloudflare for both applications.

V1 uses dedicated surface hostnames when the profile is enabled. On a portal hostname the existing verified custom-domain mapping identifies the organization. During rollout an operator must include or retire legacy hostname and path aliases for protected content. Wildcard tenant onboarding, editing Cloudflare policies from Open Mercato, and Cloudflare-to-portal identity federation are outside v1.

## 📝 Delta

### Capability: cloudflare-zero-trust-access

#### ADDED Requirement: Independent Access protection for three spaces

An enabled Enterprise ingress profile SHALL serve each space only through its configured hosts and SHALL require that space's Cloudflare Access application assertion when protection is enabled.

##### Scenario: Staff and frontend protected, portal open

- WHEN the operator protects staff and frontend and leaves portal protection off
- THEN requests for staff and frontend require their distinct Access audiences, while portal pages and portal APIs use their existing customer authentication without an Access challenge

##### Scenario: Protected portal with an open frontend

- WHEN the portal is protected and the application frontend is open
- THEN canonical portal URLs, verified portal custom hosts, and the portal's API operations cannot serve that portal through the open frontend or another host using an unrelated audience

##### Scenario: Access and application authorization

- WHEN a user passes the correct Access policy but lacks the application session or permission needed by the target
- THEN Open Mercato runs its existing login or denial flow before serving the target

#### ADDED Requirement: Optional automatic Enterprise staff sign-in

On a protected staff host with automatic sign-in enabled, an eligible browser visit with a valid human Access assertion and no staff session SHALL start the existing Enterprise SSO flow using the configured OIDC provider.

##### Scenario: Google Workspace user with existing staff access

- WHEN a staff member signs into Access through Google Workspace, the active Cloudflare session satisfies both application policies, and the federated identity is eligible in the selected Open Mercato organization
- THEN Open Mercato issues its normal staff session after the OIDC checks and any required Open Mercato challenge, and takes the user to the original permitted staff page without a second Open Mercato credential prompt

##### Scenario: Wrong identity, missing entitlement, or provider failure

- WHEN the edge and OIDC identities disagree, the account is unlinked and ineligible for existing-account linking, or any Access, SSO, or application security check fails
- THEN the attempt issues no staff session and a repeat automatic redirect is suppressed

## 📝 Architecture

### Ingress and routing

Deploy Cloudflare Tunnel in front of one trusted Enterprise ingress and keep application origin ports private. Enforce the versioned profile before forwarding to any Next.js route, including framework routes outside the module API catch-all. Generate or validate the profile against the deployment's actual pages and API methods, including contributed modules. Accept exact normalized hosts on trusted listeners, with the origin reachable only through the ingress. The ingress serves separate private listeners for operator and service networks. Strip client-supplied routing and identity headers at the trust boundary. Only trusted forwarding data may reach the application. Preserve the canonical host used by portal custom-domain and SSO URL resolution.

| Surface | Routes and dependencies to account for |
|---|---|
| Staff backend | `/backend`, staff login and logout, Enterprise SSO start and callback, staff API methods, protected downloads, staff event streams, and framework requests serving staff pages. |
| Application frontend | Public-facing module pages outside the portal and staff auth routes, plus their storefront or other frontend API methods and callbacks used by browsers. The site's own application policies still apply. |
| Customer portal | `/{orgSlug}/portal/**` and equivalent verified custom-host URLs, plus portal login, customer account and portal APIs, customer downloads and streams, and framework requests serving portal pages. Resolve scope with existing portal helpers. |

- Classify by canonical route and HTTP method, including auth endpoints, SSR, RSC, prefetch, files, API methods outside the module router, and aliases. Match the same normalized route the upstream will see. Reject ambiguous encodings, host/path conflicts, unknown hosts, and unclassified executable routes before forwarding. Public static assets must be explicitly identified as inert.
- Every route or method has an allowed surface. The reference inventory must support all eight combinations for the shipped app. A shared operation is available only where its application-side scope is provable. The ingress makes the surface available as trusted request context, and core reads that context through a provider-neutral optional boundary. If a contributed route lacks ownership or an enforceable scope, it is excluded before activating the profile. An open host cannot proxy arbitrary paths into a protected host.
- Classify stock attachment file and image reads explicitly. On the frontend, serve only records deliberately published to that frontend and allowed by the existing unauthenticated attachment check, independent of any supplied staff credentials. On the portal, use the owning customer feature's scoped authorization and same-host delivery. On the staff host, retain native staff attachment access and ACL checks. Any portal-exclusive or frontend-exclusive resource must be denied through the other hosts. Reuse the existing attachment access evaluator and add a trusted surface boundary before reading the bytes. Test file, image, signed URLs and optimizers across hosts. Shared translation and static build resources may be available on all hosts when they expose only invariant assets. [File route](../../../packages/core/src/modules/attachments/api/file/%5Bid%5D/route.ts), [Image route](../../../packages/core/src/modules/attachments/api/image/%5Bid%5D/%5B%5B...slug%5D%5D/route.ts).
- When portal protection is enabled, known aliases must redirect to the protected canonical portal hostname or be rejected before serving portal pages. Preserve ordinary alias handling for an open portal. Register staff and frontend hosts as platform domains and map portal hosts through the verified custom-domain resolver. Resolve portal API scope from the host and existing persisted customer identity. Include `domain-resolve` in the private internal route inventory where needed for custom-domain resolution. Keep public caching disabled for gated pages, APIs, personalized downloads, and SSO routes. Permit caching for explicitly public build assets.
- Pin a separate Access audience per protected surface or security zone. Validate exactly one `Cf-Access-Jwt-Assertion` with RS256 and the configured team's public keys. Require exact issuer, matching audience, application token type, expiration, and valid applicable time claims. Reject global-session and OIDC tokens at this boundary. Bound key fetch time, coalesce refreshes on rotation, and reject assertions when no valid verification key is available. The provider hostname and keys come from trusted deployment configuration. [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
- For protected browser routes require a human application assertion. For operator-approved automation, an independent Access Service Auth audience may admit a service credential on a declared machine hostname and exact routes/methods. Also require the existing Open Mercato machine authentication and permission checks. Required external webhooks may use a dedicated public callback host with only named methods and existing provider signature checks. Health probes and backend-to-backend calls use private listeners with explicit route and network scope. These service listeners expose no browser entry points or broad API exception. A separate private recovery hostname requires independently authenticated operator-network access and allows only the existing password and MFA entry points, their session dependencies, and named SSO administration routes protected by native RBAC. It stays unreachable from every public hostname.
- Account for session expiry on streaming connections. Bound protected stream lifetime by the verified Access expiry as well as existing application stream limits and require a fresh Access check on reconnect. Cloudflare policy changes can propagate later than Open Mercato deactivation. The deployment runbook covers revoking Access and Open Mercato sessions during offboarding. [Cloudflare session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/), [Google Workspace group propagation](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google-workspace/#group-membership-not-reflected-in-access-policies).

### Optional staff sign-in

1. Configure a Cloudflare self-hosted Access application for the staff host and a separate Cloudflare Access for SaaS OIDC application on the same team using the authorized Google Workspace identity provider. The latter has its own policy, issuer, client ID, client secret, and exact HTTPS callback. Approve the same staff population in both applications. The reference rollout targets an organization without another active or inactive SSO configuration, since only one non-deleted config per organization is supported. An organization with an existing config keeps it and can adopt protection-only. Migrating an existing provider and its identity links is outside this proposal. Cloudflare may reuse the browser's active Access session, subject to provider, policy, and session lifetime.
2. An admitted top-level GET for a staff page that requires authentication starts Enterprise SSO after normal session resolution and refresh find no valid staff session. Use an optional server-side staff login handoff at that decision point. Bind the attempt to the configured staff host, SSO config ID/version, and a sanitized same-host staff return path. If native session verification is temporarily unavailable, preserve the native retryable error. The dedicated provider config always requires the protected-host handoff for automatic and explicit sign-in, even if a caller supplies its ID directly to the generic initiate route. Explicit retries use the same guarded path. The existing OIDC flow supplies state, PKCE, and nonce. Exclude APIs, speculative requests, assets, callback, logout, and error entry points from automatic starts. An authenticated staff visit proceeds through ordinary authorization.
3. On the callback, require the current human staff Access assertion again and the same host, Access subject, and configuration as the start. Resolve the OIDC identity using validated issuer, client audience, state, nonce, and code exchange. Require a verified email from that OIDC provider that matches the human assertion's email using the existing identity normalization rules. Bind the staff account by the existing configuration-scoped OIDC subject link. An initial link to an existing staff account requires explicitly enabled and authorized Enterprise SSO verified-email linking within the configured tenant and organization. No account is created, and role mappings and SCIM/JIT settings outside this dedicated config remain untouched. Default this config to JIT off and no group-to-role mappings. Derive staff permissions through existing Enterprise SSO authority and live Open Mercato RBAC.
4. Enterprise SSO performs its existing final configuration/account authorization and issues the standard staff cookies only once the applicable Open Mercato login security policy is satisfied. Preserve MFA, enrollment, and step-up requirements. The current generic OIDC callback issues a session directly. Phase 2 must route any required additional factor through the canonical Security challenge before final session issuance, preserve SSO provenance through challenge completion, and rerun the authority check after completion. If a required application factor cannot be enforced, the handoff remains unavailable to the affected account and policy. Cloudflare posture and MFA independently control perimeter admission.
5. Local sign-out revokes the Open Mercato session and suppresses automatic starts for the signed-out browser until explicit sign-in. Document the separate Cloudflare sign-out and revocation actions. Preserve a tested private recovery path for authorized operators using the dedicated recovery hostname and existing password break-glass and MFA policy. Application sign-in errors fall back to the existing login experience and rules within the protected staff host.

**Phase 2 acceptance gate.** Before enabling auto sign-in, verify a real non-production Cloudflare and Google Workspace configuration. Confirm OIDC discovery, code flow with S256/state/nonce, exact callback, verified email claim and identity match, Access session reuse without an extra credential prompt, application MFA as required, sign-out, and revocation. Cloudflare's OIDC documentation establishes protocol support. It does not certify these behaviors for an Open Mercato deployment. Missing claim or incompatible policy leaves the protection-only profile available. [Cloudflare generic OIDC application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/saas-apps/generic-oidc-saas/), [Open Mercato Google Workspace SSO setup](../../../apps/docs/docs/enterprise/sso/google-workspace-setup.mdx).

## 📝 Data Models

No new entities or migrations are proposed. A deployment-owned profile holds enabled surface/host bindings, expected team issuer and audiences, exact route/method inventory, and the optional staff host-to-SSO configuration binding. A protected portal host must resolve to the verified scope already stored by Customer Accounts.

Reuse encrypted `SsoConfig` provider credentials, existing `SsoIdentity` links, and staff session provenance. Store only the minimal comparison data for a pending staff handoff in its short-lived protected SSO state. Do not persist Access JWTs, OIDC tokens, or raw user identifiers in logs. Record audit and metrics outcomes by surface, decision reason class, and request correlation ID. Staff SSO uses its existing scoped events.

## 📝 API Contracts

| Entry point | Proposed behavior with the profile enabled |
|---|---|
| Each admitted page/API route | The ingress sends the canonical request through after its host, route, and Access checks. Unauthorized origin requests return generic 403 and never invoke the application handler. Unclassified host-route combinations return 404. Indeterminate key availability returns a retryable 503. Existing application route statuses and payloads apply after admission. |
| `GET /api/sso/initiate` and `GET/POST /api/sso/callback/oidc` | Preserve their public shape. The Cloudflare provider binding selects its server-configured host and requires the protected handoff state on initiation and callback, including explicit staff sign-in. Other SSO configs follow their existing behavior. The reference OIDC app uses the GET authorization-code callback. The ingress applies the Staff audience to both routes. |
| Staff/customer APIs and public callbacks | Continue using their own credentials and feature/tenant guards. An Access assertion is never accepted as an application bearer credential. Preserve browser/API differences when Cloudflare challenges a request before origin. |

## 📝 UI/UX

The Cloudflare-hosted challenge precedes the existing Open Mercato page or login. Automatic staff sign-in follows a normal browser redirect back to the original permitted page and reuses the existing localized SSO failure and MFA surfaces. After sign-out or a failed automatic attempt, the existing staff sign-in action lets users retry intentionally. Portal users continue to see the existing portal login when their destination requires it. Deployment configuration lives in operator-managed files and existing Enterprise SSO configuration. This design adds no new product screens.

## 📝 Edge Cases & Failure Scenarios

- A disabled Enterprise profile or an installation with no profile uses the existing deployment and app authentication. A missing issuer/audience, invalid route coverage, or ambiguous host in an enabled profile blocks activation. An upgrade with a new unclassified route blocks the affected rollout until its surface is declared.
- Expired, missing, or wrong-audience application assertions fail at the ingress even when a valid Open Mercato cookie or API key is present. If Cloudflare or its signing keys are unavailable, the protected surface fails closed while independent ungated surfaces remain available.
- A user can pass Access and still have no eligible staff or customer account. Preserve generic errors, deny cross-organization account selection, and do not treat matching email domains, group membership, or an existing staff browser session as evidence of portal identity.
- A malformed callback, changed Access identity, changed SSO config, revoked config author, deactivated staff account, or unsuccessful MFA fails before session issuance. Concurrent attempts follow the existing SSO session and authority locking. Sanitize redirect targets and test the signed-out landing page and expired-state retries for loops.
- Rehearse outbound provider/webhook behavior and private service calls with the ingress enforced. Activation requires that necessary integrations have their explicit host/route and independent authentication. No implicit bypass is created on failure.

## Migration & Backward Compatibility

Existing deployments opt in individually. Preserve API URLs, methods, cookie formats and names, event IDs, application roles, tenant resolution, and built-in sign-in options subject to the existing local SSO policy. Enabling a surface changes the network prerequisite for that surface and may require consumers to move to its canonical hostname or an approved integration endpoint. Start with a separate staging hostname and a complete inventory before moving production traffic. Roll back an affected surface by routing to a previously approved secured profile, or taking it offline while repairing policy. Keep the origin private throughout. Turn off automatic starts to restore explicit staff sign-in behind Access, with the provider still bound to its protected host. To retire the Cloudflare provider, deactivate its Enterprise SSO configuration and revoke its sessions before removing the host binding.

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation and residual impact |
|---|---|---|
| Unclassified or misclassified API, rewritten route, cache, or alternate origin serves a protected resource | High | Require private upstream networking, canonical combined host/route validation, no-store for protected responses, and coverage tests through real ingress. Custom modules need profiling before rollout. |
| Automatic login attempts the wrong account or grants authority beyond the configured organization | High | Pin the SSO config to the host, bind and verify the transaction across both proofs, reuse existing account linking and live authority, and verify the actual IdP claim configuration before enabling. |
| Cloudflare or IdP configuration fails, causing lockout or repeated redirects | High | Validate before activation, canary on staging, fail closed per configured surface, suppress automatic retries, and rehearse private recovery. Availability still depends on Cloudflare for protected public entry points. |
| Deactivation lags through Cloudflare caches or open streams | Medium | Validate on each request, cap stream lifetime, revoke Access and app sessions, and use live Open Mercato SSO checks. Access revocation and app-session revocation are separate actions. |
| Portal custom domain cuts over to a different tenant or frontend session | High | Make verified domain scope authoritative and test both slug and custom-host access, including domain disablement and cross-host cookies. |

## 📋 Phasing

- **Phase 1 — Per-surface Access protection.** Deploy the ingress profile and three-space coverage with ordinary Open Mercato authentication.
- **Phase 2 — Optional staff sign-in.** Add and pilot the OIDC handoff on a protected staff host. The gate from Phase 1 remains deployable on its own.

## 📋 Implementation Plan

### Phase 1 — Per-surface Access protection

1. Inventory the three spaces and their HTTP methods, custom-host aliases, auth routes, direct framework routes, downloads, streams, and integrations. Freeze staff, storefront, and portal routes against the disabled profile. Add profile schema and validation with an opt-in default.
2. Implement Enterprise ingress enforcement for the private-origin/Tunnel reference deployment. Complete the stock inventory, including surface restrictions for shared media handlers. Validate assertions with a local test issuer and verify all eight protection combinations.
3. Wire portal custom hosts and exact service/callback routes. Add alerts and a deployment/rollback runbook. Verify the full browser flows and native authorization after the gate.

### Phase 2 — Optional staff sign-in

4. Probe the documented Cloudflare OIDC exchange in staging with Google Workspace. Record discovery, PKCE, nonce, verified claim availability, and whether the browser's Access session can be reused. Keep automatic mode off.
5. Add the staff-only handoff and protected callback binding using the Enterprise SSO state and authorization services. Wire the canonical MFA challenge where required and verify that staff sessions retain SSO provenance. Deploy the handoff off by default.
6. Run the full browser and API acceptance gate in staging with Google Workspace, including MFA, session issuance, logout, revocation and recovery. Enable the handoff only after the gate passes.
7. Archive each shipped phase's Delta into the Enterprise capability record at `.ai/specs/enterprise/capabilities/cloudflare-zero-trust-access.md` in its implementation PR.

## Integration coverage

Use repository-native integration tests, isolated API fixtures and a local signed test issuer. Clean up created staff, portal users and tenants, configurations, test keys, and custom domains. Run browser tests through the actual ingress with enterprise modules enabled. Keep the live Cloudflare sandbox acceptance separate so CI needs no real provider credentials.

| Path or flow | Coverage |
|---|---|
| Surface selection and browser navigation | All eight on/off combinations at the policy layer, plus browser staff-only, frontend-only, staff+frontend, portal-only, all-enabled and disabled deployments as applicable. Verify ordinary frontend requests and client navigation, staff login/deep link/logout, and portal login/profile via slug and custom domain. |
| Staff, frontend, and portal API routes | Fixture-backed requests require the appropriate audience, valid native login and feature, include direct framework endpoints and shared routes, and reject misrouted host/tenant requests. Cover attachments, streaming expiry/reconnect, prefetch, caching and alternate ingress paths. |
| Machine and callback routes | Valid Access Service Auth plus a scoped native API credential admits only declared routes. Provider-signature validation, health probes, and private portal domain resolution work on their designated listeners. |
| OIDC initiation and callback | Eligible and prelinked staff, approved first verified-email link, wrong host or direct generic initiation, unverified/missing/mismatched claims, login-state and provider mismatch, revocation race, tenant/organization mismatch, and role/authority ceiling. Check manual SSO with automatic mode off. |
| Staff browser flow | Google Workspace session reuse in staging, deep-link restoration, application MFA enforcement, no implicit account switching during the handoff, expired Access, provider outage, explicit retry, logout loop prevention and private recovery. Verify that portal cookies are only issued through portal auth. |

## Final Compliance Report

The design assigns enforcement and configuration to Enterprise, retains the existing portal and staff authority boundaries, and proposes no persisted schema or public API changes. Verification for this design covers current routing and SSO code and provider documentation. Runtime acceptance requires the ingress matrix and the separate Cloudflare/Google Workspace pilot described above.

## Changelog

- 2026-11-24 — Initial Enterprise proposal for independent Cloudflare Access protection and optional staff sign-in.
