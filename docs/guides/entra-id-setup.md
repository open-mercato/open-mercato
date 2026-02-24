# Microsoft Entra ID Setup Guide for Open Mercato SSO + SCIM

This guide walks through setting up Microsoft Entra ID (formerly Azure AD) as the identity provider for both OIDC login and SCIM user provisioning in Open Mercato.

**Free tier**: Entra ID Free is included with any Azure subscription — no paid license required for basic OIDC + SCIM.

---

## 1. Create an Azure Account + Entra ID Tenant

1. Go to https://azure.microsoft.com/free and create a free account (or use an existing one)
2. Navigate to https://entra.microsoft.com (the Entra admin center)
3. You'll have a default tenant — note your **Tenant ID** from **Overview** → **Tenant ID**

## 2. Create Test Users

1. In the Entra admin center, go to **Identity** → **Users** → **All users**
2. Click **+ New user** → **Create new user**
3. Fill in:
   - **User principal name**: e.g., `testuser@yourtenant.onmicrosoft.com`
   - **Display name**: e.g., `Test User`
   - **First name** / **Last name**
   - **Password**: auto-generate or set manually
4. Click **Create**
5. Repeat for 2-3 test users

## 3. Register the OIDC Application (SSO Login)

1. In the Entra admin center, go to **Identity** → **Applications** → **App registrations**
2. Click **+ New registration**
3. Configure:

| Field | Value |
|-------|-------|
| **Name** | `Open Mercato` |
| **Supported account types** | `Accounts in this organizational directory only` (Single tenant) |
| **Redirect URI** | Platform: `Web`, URI: `http://localhost:3000/api/sso/callback/oidc` |

4. Click **Register**
5. You'll land on the app's **Overview** page — note:
   - **Application (client) ID** — this is your Client ID
   - **Directory (tenant) ID** — used in the issuer URL

### Create a Client Secret

1. Go to **Certificates & secrets** → **Client secrets** tab
2. Click **+ New client secret**
3. Description: `Open Mercato Dev`, Expiry: `6 months` (or your preference)
4. Click **Add**
5. **Copy the secret Value immediately** — it's shown only once

### OIDC Credentials Summary

| Credential | Where to find it | Value |
|------------|-----------------|-------|
| **Issuer URL** | Computed from Tenant ID | `https://login.microsoftonline.com/{tenant-id}/v2.0` |
| **Client ID** | App registration → Overview | Copy from portal |
| **Client Secret** | App registration → Certificates & secrets | Copy the **Value** (not Secret ID) |
| **Redirect URI** | You configured this | `http://localhost:3000/api/sso/callback/oidc` |

### Configure Token Claims

By default, Entra ID v2.0 tokens may not include `email` in the ID token. Fix this:

1. Go to your App registration → **Token configuration**
2. Click **+ Add optional claim**
3. Token type: **ID**
4. Check: `email`, `given_name`, `family_name`
5. Click **Add**
6. When prompted about Microsoft Graph permissions, check the box and click **Add**

### API Permissions

1. Go to **API permissions**
2. Verify these are present (they should be by default):
   - `Microsoft Graph` → `openid` (Delegated)
   - `Microsoft Graph` → `profile` (Delegated)
   - `Microsoft Graph` → `email` (Delegated)
3. If any are missing, click **+ Add a permission** → **Microsoft Graph** → **Delegated permissions** → search and add them
4. Click **Grant admin consent for [your tenant]** (green checkmark button)

### Assign Users to the Application

1. Go to **Identity** → **Applications** → **Enterprise applications**
2. Find and click **Open Mercato**
3. Go to **Users and groups** → **+ Add user/group**
4. Select your test users (or a group containing them)
5. Click **Assign**

**Important**: If "Assignment required?" is set to **Yes** (under Properties), only assigned users can log in. Set to **No** for dev if you want all tenant users to access it.

---

## 4. Create the SSO Config in Open Mercato

1. Log into Open Mercato as admin
2. Go to **Settings** → **Single Sign-On** → **Create New**
3. Select **OIDC** as the protocol
4. Enter:
   - **Name**: `Entra ID`
   - **Issuer URL**: `https://login.microsoftonline.com/{your-tenant-id}/v2.0`
   - **Client ID**: (paste from Entra)
   - **Client Secret**: (paste the secret Value from Entra)
5. Add allowed email domains (e.g., `yourtenant.onmicrosoft.com`)
6. Test the connection (Verify Discovery)
7. Activate the config

### Verify OIDC Login

1. Open a private/incognito browser window
2. Go to the Open Mercato login page
3. Enter an email address belonging to one of your test users (e.g., `testuser@yourtenant.onmicrosoft.com`)
4. The HRD check should detect SSO and redirect to Microsoft login
5. Authenticate at Microsoft
6. You should be redirected back to Open Mercato and logged in

---

## 5. Configure SCIM Provisioning

**Prerequisite**: You need a SCIM bearer token from Open Mercato. Generate one via:
- The admin UI: SSO config → Provisioning tab → Generate Token
- Or the API: `POST /api/sso/scim/tokens` with the SSO config ID

### Set Up Provisioning in Entra ID

1. Go to **Identity** → **Applications** → **Enterprise applications**
2. Find and click **Open Mercato**
3. Go to **Provisioning** → click **Get started**
4. Set **Provisioning Mode** to **Automatic**
5. In **Admin Credentials**:

| Field | Value |
|-------|-------|
| **Tenant URL** | `http://localhost:3000/api/sso/scim/v2` (dev) or `https://<your-domain>/api/sso/scim/v2` (prod) |
| **Secret Token** | Paste the SCIM bearer token from Open Mercato |

6. Click **Test Connection** — should show "The supplied credentials are authorized to enable provisioning"
7. Click **Save**

### Configure Attribute Mappings

1. Under **Mappings**, click **Provision Microsoft Entra ID Users**
2. Verify these mappings exist:

| Entra ID Attribute | SCIM Attribute | Notes |
|--------------------|----------------|-------|
| `userPrincipalName` | `userName` | Required |
| `Switch([IsSoftDeleted]...)` | `active` | Required — Entra uses a Switch expression |
| `givenName` | `name.givenName` | Required |
| `surname` | `name.familyName` | Required |
| `mail` | `emails[type eq "work"].value` | Required — user's email |
| `displayName` | `displayName` | Optional |
| `objectId` | `externalId` | Required — Entra's unique ID |

3. Keep default mappings — they should work out of the box
4. Click **Save**

### Start Provisioning

1. Back on the **Provisioning** page, set **Provisioning Status** to **On**
2. Click **Save**
3. Entra will run an initial provisioning cycle (may take up to 40 minutes for the first cycle)
4. Check **Provisioning logs** for results

### Provisioning Cycle Timing

- **Initial cycle**: Processes all users in scope. Can take 20-40 minutes.
- **Incremental cycles**: Every 40 minutes, processes changes since last cycle.
- **On-demand provisioning**: Click **Provision on demand** to immediately provision a specific user (useful for testing).

---

## 6. Test the Full Flow

### Test SCIM Provisioning

1. In Entra, go to **Enterprise applications** → **Open Mercato** → **Provisioning**
2. Click **Provision on demand**
3. Search for a test user and click **Provision**
4. **Expected**: Entra sends `POST /Users` to your SCIM endpoint → user appears in Open Mercato
5. Check the provisioning log in Open Mercato admin UI

### Test User Update

1. In Entra, go to **Users** → edit a test user's display name
2. Wait for the next provisioning cycle (or use Provision on demand)
3. **Expected**: Entra sends `PATCH /Users/{id}` → user's name updated in Open Mercato

### Test User Deactivation

1. In Entra, either:
   - **Delete** the user (soft-delete moves to Deleted users)
   - **Block sign-in** for the user (Users → select user → Edit properties → Block sign in: Yes)
   - **Remove** the user from the application assignment
2. **Expected**: Entra sends `PATCH /Users/{id}` with `active: false` → user deactivated in Open Mercato, all sessions revoked

### Test OIDC + SCIM Together

1. **Create a new user in Entra** and assign them to the Open Mercato Enterprise app
2. **Provision on demand** (or wait for cycle)
3. **Verify** the user exists in Open Mercato (pre-provisioned, no login needed)
4. **Log in as that user** via OIDC (Open Mercato login → redirect to Microsoft → authenticate → redirect back)
5. **Expected**: The SCIM-provisioned account is used (no JIT provisioning, `provisioningMethod` stays `scim`)
6. **Block sign-in for the user in Entra**
7. **Expected**: SCIM deactivates the user → existing sessions revoked → OIDC login no longer works

---

## Entra ID SCIM Quirks

When building the SCIM endpoint, account for these Entra-specific behaviors:

| Quirk | Description | How to handle |
|-------|-------------|---------------|
| **PascalCase `op` in PATCH** | Entra sends `"op": "Replace"` instead of `"op": "replace"` | Case-insensitive comparison on PATCH operations |
| **String booleans** | `active` may be sent as `"True"` / `"False"` strings | Parse with `parseBooleanToken` |
| **Non-standard PATCH paths** | Sometimes sends `emails[type eq "work"].value` in PATCH path | Support bracket-notation in PATCH path parser |
| **Mixed-case filter operators** | Sends `Eq` instead of `eq` in filters | Case-insensitive filter parsing |
| **`externalId` mapping** | Maps `objectId` → `externalId` by default | Always store `externalId` from SCIM requests |
| **Soft delete** | Uses `IsSoftDeleted` Switch expression → `active: false` | Handle as user deactivation |

---

## Troubleshooting

### OIDC login redirects but fails

- Verify the Redirect URI in App Registration matches exactly: `http://localhost:3000/api/sso/callback/oidc`
- Check that the Issuer URL includes the tenant ID: `https://login.microsoftonline.com/{tenant-id}/v2.0`
- Verify Client ID and Client Secret (the Value, not the Secret ID)
- Ensure `email` optional claim is added to the ID token
- Ensure API permissions have admin consent granted

### "AADSTS50011: The redirect URI does not match"

The redirect URI in the authorization request doesn't match what's registered. Check:
- `APP_URL` in `.env` matches what you registered (e.g., `http://localhost:3000`)
- No trailing slash differences
- Protocol matches (http vs https)

### Users not provisioning

- Check that users are assigned to the Enterprise application
- Check **Provisioning logs** in Entra for error details
- Verify the SCIM token is valid and not revoked
- For local dev, Entra needs to reach your server — use ngrok for SCIM (even though OIDC works with localhost)

### SCIM "Test Connection" fails

- For local dev, Entra's provisioning service needs to reach your endpoint over the internet
- Use ngrok: `ngrok http 3000`
- Set Tenant URL to: `https://<id>.ngrok-free.app/api/sso/scim/v2`
- **Note**: OIDC redirect URIs can use `localhost`, but SCIM provisioning requires a publicly reachable URL

### email claim missing from ID token

1. Go to App registration → **Token configuration** → **+ Add optional claim** → ID token → check `email`
2. Go to **API permissions** → verify `email` permission → click **Grant admin consent**

---

## Key Differences from JumpCloud

| Aspect | Entra ID | JumpCloud |
|--------|----------|-----------|
| **Issuer URL** | `https://login.microsoftonline.com/{tenant-id}/v2.0` | `https://oauth.id.jumpcloud.com/` |
| **Redirect URI** | Supports `http://localhost` for dev | Requires HTTPS |
| **SCIM provisioning** | Enterprise App → Provisioning (automatic) | SSO App → Identity Management (SCIM API) |
| **Provisioning cycles** | Every 40 minutes (or on-demand) | Near real-time |
| **SCIM quirks** | PascalCase ops, string booleans, mixed-case filters | Mostly spec-compliant |
| **Free tier** | Free with any Azure account | 10 users forever |

---

## Reference

- [Entra ID App Registration - OIDC](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- [Entra ID SCIM Provisioning](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups)
- [Entra ID Optional Claims](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims)
- [Entra ID SCIM Known Issues](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/application-provisioning-config-problem-scim-compatibility)
