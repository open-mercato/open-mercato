# Zitadel Setup Guide for Open Mercato SSO

This guide walks through setting up Zitadel as the identity provider for OIDC login and SCIM user provisioning in Open Mercato.

**Free tier**: Zitadel Cloud offers a free tier with up to 25,000 monthly active users.

---

## 1. Create a Zitadel Instance

1. Go to https://zitadel.com and sign up for a free account
2. Create a new instance (or use the default one)
3. Note your instance domain: `https://<instance>.zitadel.cloud`

## 2. Create Test Users

1. In the Zitadel Console, go to **Users** → **+ New**
2. Fill in:
   - **Username**: e.g., `testuser@yourdomain.com`
   - **First name** / **Last name**
   - **Email**: the user's email address
   - **Password**: set an initial password
3. Click **Create**
4. Repeat for 2-3 test users

## 3. Register the OIDC Application

1. In the Zitadel Console, go to **Projects** → **+ New**
2. Name the project `Open Mercato` and click **Continue**
3. Click **+ New Application**
4. Configure:

| Field | Value |
|-------|-------|
| **Name** | `Open Mercato` |
| **Type** | `Web` |
| **Authentication Method** | `Code (PKCE)` |
| **Redirect URIs** | `http://localhost:3000/api/sso/callback/oidc` |
| **Post-Logout URIs** | `http://localhost:3000/login` |

5. Click **Create**
6. On the application overview, note:
   - **Client ID**
   - **Client Secret** (generate one if using Code flow)

### OIDC Credentials Summary

| Credential | Where to find it | Value |
|------------|-----------------|-------|
| **Issuer URL** | Instance domain | `https://<instance>.zitadel.cloud` |
| **Client ID** | Application → General | Copy from console |
| **Client Secret** | Application → General → Generate | Copy immediately |
| **Redirect URI** | You configured this | `http://localhost:3000/api/sso/callback/oidc` |

### Configure Token Claims

Zitadel includes `email`, `given_name`, `family_name`, and `email_verified` in ID tokens by default when the `openid`, `profile`, and `email` scopes are requested. No additional configuration is needed.

### Assign Users

By default, all users in the organization can access the application. To restrict access:

1. Go to your Project → **Authorizations** → **+ New**
2. Select specific users or grant roles
3. Enable "Require authorization" on the project settings if you want to restrict access

---

## 4. Create the SSO Config in Open Mercato

1. Log into Open Mercato as admin
2. Go to **Settings** → **Single Sign-On** → **Create New**
3. Select **OIDC** as the protocol
4. Enter:
   - **Name**: `Zitadel`
   - **Issuer URL**: `https://<instance>.zitadel.cloud`
   - **Client ID**: (paste from Zitadel)
   - **Client Secret**: (paste from Zitadel)
5. Add allowed email domains (e.g., `yourdomain.com`)
6. Test the connection (Verify Discovery)
7. Activate the config

### Verify OIDC Login

1. Open a private/incognito browser window
2. Go to the Open Mercato login page
3. Enter an email address belonging to one of your test users
4. The HRD check should detect SSO and redirect to Zitadel login
5. Authenticate at Zitadel
6. You should be redirected back to Open Mercato and logged in

---

## 5. Configure SCIM Provisioning

**Prerequisite**: Generate a SCIM bearer token from Open Mercato via the admin UI (SSO config → Provisioning tab → Generate Token).

### Zitadel SCIM Support

Zitadel supports outbound SCIM provisioning through its **Actions** feature (custom workflows). As of 2026, Zitadel also offers a native SCIM provisioning option:

1. Go to your Project → **Open Mercato** application
2. Navigate to **Provisioning** or **Actions**
3. Configure SCIM outbound provisioning:

| Field | Value |
|-------|-------|
| **SCIM Base URL** | `http://localhost:3000/api/sso/scim/v2` (dev) or `https://<your-domain>/api/sso/scim/v2` (prod) |
| **Bearer Token** | Paste the SCIM token from Open Mercato |

4. Test the connection

### Alternative: Manual/API-Based Provisioning

If Zitadel's native SCIM outbound is not available in your version, use the Zitadel Management API to sync users:

1. Create a Service User in Zitadel with Management API access
2. Use the Zitadel Management API to list users
3. Push user changes to Open Mercato's SCIM endpoint

---

## 6. Test the Full Flow

### Test OIDC Login

1. Navigate to Open Mercato login
2. Enter a test user's email
3. **Expected**: Redirect to Zitadel → authenticate → redirect back to Open Mercato
4. Verify the user appears in the Open Mercato admin panel

### Test JIT Provisioning

If SCIM is not configured and JIT is enabled:

1. Log in as a new user via OIDC
2. **Expected**: User is automatically created in Open Mercato with `provisioningMethod: jit`
3. Verify user profile (name, email) matches Zitadel

### Test SCIM Provisioning (if configured)

1. Create a new user in Zitadel
2. Wait for provisioning cycle (or trigger manually)
3. **Expected**: User appears in Open Mercato with `provisioningMethod: scim`
4. Update the user in Zitadel → verify changes propagate
5. Deactivate the user in Zitadel → verify deactivation in Open Mercato

---

## Zitadel SCIM Quirks

| Quirk | Description | How to handle |
|-------|-------------|---------------|
| **Standard-compliant** | Zitadel follows SCIM 2.0 spec closely | Standard parsing works |
| **`email_verified` claim** | Always included in ID tokens | No special handling needed |
| **Group claims** | Available via project roles | Configure role mappings if needed |
| **PKCE support** | Natively supports S256 PKCE | Automatically used by Open Mercato |

---

## Troubleshooting

### OIDC login redirects but fails

- Verify the Redirect URI matches exactly: `http://localhost:3000/api/sso/callback/oidc`
- Check that the Issuer URL matches your instance: `https://<instance>.zitadel.cloud`
- Verify Client ID and Client Secret
- Check the Zitadel Console → **Events** for error details

### "redirect_uri_mismatch" error

- Ensure the redirect URI registered in Zitadel matches exactly (including protocol and port)
- No trailing slash differences
- For production, use HTTPS

### Users can't log in

- Check that users exist in the same Zitadel organization
- If "Require authorization" is enabled on the project, ensure users have project grants
- Check that the email domain matches the allowed domains in Open Mercato SSO config

### SCIM connection fails

- For local dev, Zitadel needs to reach your server over the internet
- Use ngrok: `ngrok http 3000`
- Update the SCIM Base URL to the ngrok URL

---

## Reference

- [Zitadel OIDC Documentation](https://zitadel.com/docs/guides/integrate/login/oidc)
- [Zitadel SCIM Documentation](https://zitadel.com/docs/guides/integrate/scim)
- [Zitadel Actions](https://zitadel.com/docs/guides/manage/customize/actions)
- [Zitadel Cloud](https://zitadel.com/pricing)
