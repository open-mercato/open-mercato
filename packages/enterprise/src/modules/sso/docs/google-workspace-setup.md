# Google Workspace Setup Guide for Open Mercato SSO

This guide walks through setting up Google Workspace as the identity provider for OIDC login in Open Mercato. Google Workspace supports JIT (Just-In-Time) provisioning only — SCIM push provisioning is not available.

**Free tier**: Google Cloud OAuth 2.0 is free for internal Workspace applications. No paid APIs required.

---

## 1. Prerequisites

- A Google Workspace account with admin access
- A custom domain verified in Google Workspace (e.g., `company.com`)
- Access to the Google Cloud Console (https://console.cloud.google.com)

## 2. Create a Google Cloud Project

1. Go to https://console.cloud.google.com
2. Click the project selector in the top bar → **New Project**
3. Name: `Open Mercato SSO` (or your preference)
4. Click **Create**
5. Switch to the new project in the project selector

## 3. Configure the OAuth Consent Screen

1. In the left sidebar, go to **APIs & Services** → **OAuth consent screen**
2. Select **Internal** (restricts login to your Workspace organization only)
3. Click **Create**
4. Fill in:

| Field | Value |
|-------|-------|
| **App name** | `Open Mercato` |
| **User support email** | Your admin email |
| **Authorized domains** | Your Workspace domain (e.g., `company.com`) |
| **Developer contact email** | Your admin email |

5. Click **Save and Continue**
6. On the **Scopes** step, click **Add or Remove Scopes** and add:
   - `openid`
   - `email`
   - `profile`
7. Click **Update** → **Save and Continue**
8. Review and click **Back to Dashboard**

## 4. Create OAuth 2.0 Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **OAuth client ID**
3. Configure:

| Field | Value |
|-------|-------|
| **Application type** | `Web application` |
| **Name** | `Open Mercato SSO` |
| **Authorized redirect URIs** | `http://localhost:3000/api/sso/callback/oidc` |

4. Click **Create**
5. **Copy the Client ID and Client Secret immediately** — you can also retrieve them later from the credentials list

### OIDC Credentials Summary

| Credential | Value |
|------------|-------|
| **Issuer URL** | `https://accounts.google.com` |
| **Client ID** | Copy from Credentials page |
| **Client Secret** | Copy from Credentials page |
| **Redirect URI** | `http://localhost:3000/api/sso/callback/oidc` |

**Note**: Google's OIDC discovery document is at `https://accounts.google.com/.well-known/openid-configuration`.

## 5. Create the SSO Config in Open Mercato

1. Log into Open Mercato as admin
2. Go to **Settings** → **Single Sign-On** → **Create New**
3. Select **OIDC** as the protocol
4. Enter:
   - **Name**: `Google Workspace`
   - **Issuer URL**: `https://accounts.google.com`
   - **Client ID**: (paste from Google Cloud Console)
   - **Client Secret**: (paste from Google Cloud Console)
5. Add your Workspace domain as an allowed domain (e.g., `company.com`)
6. Enable **JIT Provisioning** (recommended — creates accounts on first login)
7. Enable **Auto-link by email** (recommended — links existing accounts by email match)
8. Click **Verify Discovery** to test the OIDC configuration
9. Save and activate the configuration

## 6. Verify OIDC Login

1. Open a private/incognito browser window
2. Go to the Open Mercato login page
3. Enter an email address with your Workspace domain (e.g., `user@company.com`)
4. The login page should detect SSO and show "Continue with SSO"
5. Click it — you'll be redirected to Google's login page
6. Authenticate with your Google Workspace account
7. You should be redirected back to Open Mercato and logged in

---

## Google Workspace Specifics

### No SCIM Provisioning

Google Workspace does not support SCIM push provisioning to third-party applications. Users are provisioned via JIT on their first SSO login. The Provisioning tab in the Open Mercato admin UI will show an informational message for Google Workspace configurations.

To manage user access:
- **Provision**: Users are created automatically on first login via JIT
- **Deprovision**: Remove the user's Workspace account or change their domain to stop SSO access

### No Group Claims by Default

Google's standard OIDC tokens do not include group membership claims. If you need role-based access from Google groups, you would need to configure a custom claim via Google's Directory API (advanced setup, not covered here).

For most setups: leave **Role Mappings** empty in the SSO config. Users will log in with their default assigned role.

### `hd` Claim

Google OIDC returns a `hd` (hosted domain) claim for Workspace accounts. This identifies the user's organization domain. Open Mercato validates the user's email domain against the allowed domains configured in the SSO config.

### `email_verified`

Google Workspace accounts always return `email_verified: true`. Personal Gmail accounts may have unverified emails — configuring the consent screen as **Internal** prevents personal accounts from accessing the application.

---

## Troubleshooting

### "Access blocked: Open Mercato has not completed the Google verification process"

This appears when the consent screen is set to **External** without Google verification. Solution: set the consent screen to **Internal** (Workspace users only).

### OIDC login redirects but fails

- Verify the Redirect URI matches exactly: `http://localhost:3000/api/sso/callback/oidc`
- Verify the Issuer URL is `https://accounts.google.com` (not a tenant-specific URL)
- Ensure `openid`, `email`, and `profile` scopes are configured on the consent screen
- Check that the user's email domain matches an allowed domain in the SSO config

### "Error 400: redirect_uri_mismatch"

The redirect URI in the authorization request doesn't match what's registered in Google Cloud Console. Check:
- `APP_URL` in `.env` matches what you registered (e.g., `http://localhost:3000`)
- No trailing slash differences
- Protocol matches (http vs https)
- The URI is listed in **Authorized redirect URIs**, not **Authorized JavaScript origins**

### User gets "No roles could be resolved"

This happens when **Role Mappings** are configured but Google doesn't send group claims. Solution: clear the Role Mappings section in the SSO config (leave it empty) to allow login without IdP-based role assignment.

### Personal Gmail accounts can log in

If you set the consent screen to **External**, any Google account can authenticate. To restrict to your organization only, set the consent screen to **Internal**.

---

## Key Differences from Entra ID

| Aspect | Google Workspace | Entra ID |
|--------|-----------------|----------|
| **Issuer URL** | `https://accounts.google.com` (same for all orgs) | `https://login.microsoftonline.com/{tenant-id}/v2.0` |
| **SCIM provisioning** | Not supported | Enterprise App → Provisioning |
| **Group claims** | Not in standard OIDC tokens | Via optional claims configuration |
| **User provisioning** | JIT only (on first login) | JIT or SCIM (automatic sync) |
| **Org restriction** | OAuth consent screen: Internal | App registration: Single tenant |
| **Free tier** | Free with any Workspace plan | Free with any Azure account |
| **Redirect URIs** | Supports `http://localhost` for dev | Supports `http://localhost` for dev |

---

## Reference

- [Google Cloud OAuth 2.0 Setup](https://developers.google.com/identity/protocols/oauth2)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google Workspace Admin: OAuth Apps](https://support.google.com/a/answer/7281227)
