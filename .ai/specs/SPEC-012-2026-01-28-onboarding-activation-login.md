# Onboarding Activation Login

## Overview
This specification defines the onboarding activation flow updates that prevent duplicate tenant provisioning, propagate tenant context into login, and support tenant-scoped authentication for multi-tenant email addresses.

## Problem Statement
Safari prefetch requests can trigger onboarding activation twice, resulting in duplicate tenant creation. Additionally, users need a deterministic tenant context when signing in because the same email can exist across multiple tenants, and onboarding activation should guide users to the correct tenant login.

## Proposed Solution
- Introduce a processing lock on onboarding requests that blocks duplicate provisioning for 15 minutes.
- Persist tenant context from activation and surface it on the login screen.
- Require tenant-scoped login when multiple users share the same email.
- Provide a public tenant lookup endpoint for login UI display.

## Architecture
- Onboarding verification transitions a request to `processing` with a timestamp.
- Subsequent activation hits within the lock window redirect to login with the resolved tenant id (when available).
- Activation completion redirects to `/login?tenant=<tenantId>` and sets a tenant cookie.
- Login UI stores tenant id in local storage/cookie and fetches tenant metadata for display.
- Login API accepts optional tenant id; if missing and multiple users match, return a tenant-required error.

## Data Models
- `onboarding_requests`
  - `status`: add `processing`
  - `processing_started_at`: timestamp used to gate duplicate runs

## API Contracts
- `GET /api/onboarding/onboarding/verify?token=...`
  - Redirects to `/login?tenant=<tenantId>` on completion or when already processed.
  - Uses a 15-minute processing lock to prevent duplicate provisioning.
- `GET /api/directory/tenants/lookup?tenantId=<uuid>`
  - Public endpoint returning `{ id, name }` for login display.
- `POST /api/auth/login`
  - Accepts `tenantId` as optional form field; scopes user lookup when provided.
  - Returns a tenant-required error when multiple users share the same email and no tenant is supplied.

## UI/UX
- Login page:
  - If tenant id is present, show a banner: "You're logging in to <tenant> tenant."
  - Provide a "Clear" action that removes the tenant context and reloads the login screen.
  - Use existing auth error styling for tenant-related errors.

## Configuration
- No new environment variables.
- Processing lock window: 15 minutes (configurable in code).

## Alternatives Considered
- Ignoring prefetch requests based on request headers.
- Auto-login after activation (kept for future consideration, but replaced here with login redirect to enforce tenant context).

## Implementation Approach
1. Add processing lock fields to onboarding request entity.
2. Update onboarding verification to guard duplicate runs and redirect to login with tenant context.
3. Add public tenant lookup endpoint.
4. Update login UI to persist tenant context and display tenant banner.
5. Update login API to support tenant-scoped lookup and tenant-required error.

## Migration Path
- Generate a module migration after adding `processing_started_at` and `processing` status to onboarding requests.
- No data backfill required.

## Success Metrics
- No duplicate tenant creation from repeated activation link hits.
- Login flow consistently identifies tenant context when provided.

## Open Questions
- Should the processing lock duration be configurable via environment variable?
- Should activation always redirect to login or be configurable per environment?

## Changelog

### 2026-01-28
- Added onboarding activation processing lock and tenant-aware login flow.
