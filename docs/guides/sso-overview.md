# SSO Module Overview

Open Mercato's SSO module provides enterprise-grade Single Sign-On with OIDC and SCIM 2.0 support. This document covers architecture, configuration, and operational guidance.

---

## Supported Identity Providers

| IdP | OIDC Login | SCIM Provisioning | JIT Provisioning | Notes |
|-----|------------|-------------------|------------------|-------|
| **Microsoft Entra ID** | Yes | Yes | Yes | Full OIDC + SCIM support. See [Entra ID Setup Guide](./entra-id-setup.md) |
| **Zitadel** | Yes | Yes | Yes | OIDC + SCIM via Actions/native. See [Zitadel Setup Guide](./zitadel-setup.md) |
| **Google Workspace** | Yes | No | Yes (recommended) | OIDC only, no SCIM push. See [Google Workspace Setup Guide](./google-workspace-setup.md) |

---

## Architecture

### Authentication Flow (OIDC)

```
User → Login Page → HRD Check → IdP Redirect → IdP Login → Callback → Session
```

1. **Home Realm Discovery (HRD)**: User enters email, the system checks if the email domain matches an active SSO config
2. **Authorization Request**: OIDC Authorization Code + PKCE flow initiated with encrypted state cookie
3. **IdP Authentication**: User authenticates at the identity provider
4. **Callback Processing**: Authorization code exchanged for tokens, ID token validated
5. **Account Linking**: User matched to existing account (by email or SSO subject) or JIT-provisioned
6. **Session Creation**: Auth session established, user redirected to the application

### User Provisioning

Two provisioning methods are supported, **mutually exclusive** per SSO config:

**JIT (Just-In-Time) Provisioning**
- Users are created automatically on first OIDC login
- Profile data extracted from ID token claims
- Best for: Google Workspace, small organizations, simple setups

**SCIM 2.0 Provisioning**
- Users are pre-provisioned by the IdP before first login
- Supports create, update, deactivate, and delete operations
- Best for: Entra ID, large organizations needing lifecycle management

### Mutual Exclusivity

JIT and SCIM cannot be enabled simultaneously on the same SSO config:
- Enabling JIT blocks SCIM token creation
- Creating SCIM tokens blocks enabling JIT
- Switching requires disabling one before enabling the other

---

## Configuration

### Admin Setup Steps

1. **Create SSO Config**: Settings → Single Sign-On → Create New
2. **Enter IdP Credentials**: Issuer URL, Client ID, Client Secret
3. **Add Allowed Domains**: Email domains that should use this SSO config
4. **Choose Provisioning**: Enable JIT or configure SCIM tokens
5. **Test Connection**: Verify the IdP discovery endpoint is reachable
6. **Activate**: Enable the config for production use

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sso/config` | POST | Create SSO config |
| `/api/sso/config` | GET | List SSO configs |
| `/api/sso/config/:id` | GET | Get config by ID |
| `/api/sso/config/:id` | PUT | Update config |
| `/api/sso/config/:id` | DELETE | Delete config (must be inactive) |
| `/api/sso/config/:id/activate` | POST | Activate/deactivate config |
| `/api/sso/config/:id/domains` | POST | Add domain |
| `/api/sso/config/:id/domains` | DELETE | Remove domain |
| `/api/sso/config/:id/test` | POST | Test IdP connection |
| `/api/sso/hrd` | POST | Home Realm Discovery lookup |
| `/api/sso/initiate` | GET | Start SSO login flow |
| `/api/sso/callback/oidc` | GET | OIDC callback |
| `/api/sso/scim/tokens` | POST | Create SCIM token |
| `/api/sso/scim/tokens` | GET | List SCIM tokens |
| `/api/sso/scim/tokens/:id` | DELETE | Revoke SCIM token |
| `/api/sso/scim/v2/Users` | POST | SCIM: Create user |
| `/api/sso/scim/v2/Users` | GET | SCIM: List users |
| `/api/sso/scim/v2/Users/:id` | GET | SCIM: Get user |
| `/api/sso/scim/v2/Users/:id` | PATCH | SCIM: Update user |
| `/api/sso/scim/v2/Users/:id` | DELETE | SCIM: Delete user |

---

## Security

### OIDC Security Controls

| Control | Implementation |
|---------|---------------|
| **PKCE** | S256 with 32-byte random code verifier |
| **State Parameter** | AES-256-GCM encrypted state cookie with HKDF key derivation |
| **Nonce** | 16-byte random nonce validated in ID token |
| **State Comparison** | Timing-safe (`crypto.timingSafeEqual`) |
| **TTL** | 5-minute state cookie lifetime |
| **CSRF** | SameSite=Lax cookies + encrypted state parameter |
| **Return URL** | Sanitized to prevent open redirects |

### SCIM Security Controls

| Control | Implementation |
|---------|---------------|
| **Token Format** | `omscim_` prefix + 32 random bytes (hex) |
| **Storage** | bcrypt-hashed (cost 10), only prefix stored |
| **One-Time Display** | Raw token returned only at creation |
| **Timing Attack** | Dummy bcrypt hash on zero candidates |
| **Tenant Isolation** | Organization ID derived from token, not request |

### Data Protection

- OIDC client secrets encrypted at rest (AES via `TenantDataEncryptionService`)
- SCIM tokens bcrypt-hashed, never retrievable after creation
- No PII in server logs
- All admin endpoints require authentication + feature-based RBAC

---

## Provisioning Methods

### JIT Provisioning

When JIT is enabled on an SSO config:

1. User authenticates via OIDC at the IdP
2. If the user does not exist in Open Mercato, a new account is created
3. Profile data (name, email) extracted from ID token claims
4. User is assigned to the organization associated with the SSO config
5. On subsequent logins, profile data is updated from the latest ID token

**Limitations**:
- User lifecycle not managed (no automatic deactivation)
- No pre-provisioning (user must log in first)
- Role assignment requires manual configuration or IdP group claims

### SCIM 2.0 Provisioning

When SCIM is configured:

1. IdP pushes user create/update/delete operations to the SCIM endpoint
2. Users are pre-provisioned before their first login
3. Profile changes in the IdP are automatically synced
4. User deactivation in the IdP triggers deactivation + session revocation
5. On OIDC login, the existing SCIM-provisioned account is linked (no duplicate)

**Supported SCIM Operations**:
- `POST /Users` — Create user
- `GET /Users` — List users (with `eq` filter support)
- `GET /Users/:id` — Get user
- `PATCH /Users/:id` — Update user (replace operations on `displayName`, `active`, `name.*`, `emails`)
- `DELETE /Users/:id` — Delete user (soft-delete + deactivation)

---

## Role Mapping

SSO configs support IdP group-to-application role mapping:

1. Configure `appRoleMappings` on the SSO config (map IdP group names to app role names)
2. When the IdP sends group claims in the ID token, roles are automatically assigned
3. If no mappings are configured, role sync is skipped (user retains existing roles)

**Google Workspace note**: Google does not send group claims by default. Role mapping is not available for Google OIDC without additional configuration.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SSO_STATE_SECRET` | Yes (production) | 32+ byte secret for state cookie encryption |
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | Recommended | Base URL for redirect URI construction |
| `SSO_DEV_SEED` | No | Set to `true` to seed demo SSO config in development |

---

## Troubleshooting

### Common Issues

**"State mismatch — possible CSRF attack"**
- State cookie expired (5-minute TTL). User took too long at the IdP.
- Browser blocking third-party cookies. Ensure SameSite=Lax cookies are allowed.

**"No roles could be resolved from IdP groups"**
- Role mappings are configured but the IdP isn't sending matching group claims.
- Remove role mappings if not needed, or configure the IdP to send group claims.

**User created with wrong provisioning method**
- Check if both JIT and SCIM have been toggled. The system enforces mutual exclusivity.
- Verify the `provisioningMethod` field on the user's SSO link record.

**SCIM requests return 401**
- Token may be revoked. Check token status in the admin UI.
- Token format: must include `Authorization: Bearer omscim_...` header.
- Check that the SSO config is active.

**SCIM requests return 403**
- The SSO config associated with the token is inactive. Activate it first.

**HRD not detecting SSO for an email domain**
- Verify the domain is added to the SSO config's allowed domains.
- Verify the SSO config is activated (inactive configs are not returned by HRD).

---

## IdP-Specific Setup Guides

- [Microsoft Entra ID Setup Guide](./entra-id-setup.md) — Full OIDC + SCIM setup
- [Zitadel Setup Guide](./zitadel-setup.md) — OIDC + SCIM setup
- [Google Workspace Setup Guide](./google-workspace-setup.md) — OIDC-only setup (JIT recommended)
