# Communication channel setup navigation

Extends: .ai/specs/implemented/SPEC-045d-communication-notification-hubs.md
Extends: .ai/specs/2026-05-21-email-integration-foundation.md

## TLDR

The shared channels list links users with integrations.view to the Communication category and users with mailbox access to their profile. The profile shows Gmail readiness before OAuth and links directly to Gmail setup for users who can view and manage integrations.

## Problem Statement

The shared channels list mentions the profile page as plain text. Gmail's connect widget attempts OAuth before checking whether the workspace has configured its client. Neither screen points directly to provider setup. [Issue #6172](https://github.com/open-mercato/open-mercato/issues/6172).

The email foundation assigns connection controls to provider widgets. The profile now groups those widgets under Connect channel, so the readiness check belongs in the Gmail widget. Chatwoot also separates provider-specific instructions from the user's mailbox setup flow. [Chatwoot inbox setup](https://www.chatwoot.com/hc/user-guide/articles/1677492191-adding-inboxes).

## Resolved assumptions (autonomous defaults)

| Decision | Rationale |
| --- | --- |
| Track shortcuts and OAuth readiness as independently deliverable phases in this proposal. | Both phases address one setup journey, and the acceptance tests can verify them separately. |
| Leave the optional Gmail callback URI copy control for separate work. | Its deployment URL behavior is independent of finding the setup screens and checking credentials. |
| Check saved OAuth client configuration only. Keep the existing initiation and callback as the final check. | A read-only status request can confirm the client ID and secret are present without starting OAuth or contacting the provider. |
| Put the recovery link in a dismissible page alert for callbacks and beside the provider widget for a failed start. | The link stays available long enough to act on it and avoids changing the shared flash API. |

## Proposed Solution

- Show Configure providers and Connect my mailbox in the shared channel list header and empty state wherever the user has the corresponding permissions. Configure providers opens the marketplace at the Communication category.
- Keep Gmail in the existing Connect channel disclosure. Check its readiness for the current workspace and disable its connect button during the check and when configuration is missing. After a transient status request error, show a retry action.
- Use the same local setup link after a missing-configuration error at initiation or callback. Offer it only with both integrations.view and integrations.manage because viewing the detail route also requires integrations.view.
- The provider setup link targets the registered OAuth provider's integration detail. The callback result's provider parameter must resolve to an installed OAuth provider before the profile can display the link.

## Delta

### Capability: communication-channel-setup

#### ADDED Requirement: Find the next setup step from shared channels

##### Scenario: Actions follow current feature grants

- WHEN a user opens the shared list with integrations.view THEN Configure providers opens the marketplace filtered to Communication.
- WHEN the user has communication_channels.connect_user_channel THEN Connect my mailbox opens the profile with personal channels.
- WHEN the shared list has no records THEN it offers the same actions using the same grants.

#### MODIFIED Requirement: Start the personal OAuth mailbox connection

##### Scenario: Provider setup is missing

- WHEN the Gmail client ID or secret is missing in the active workspace THEN the Gmail control is disabled and explains how to get it configured.
- WHEN a missing-configuration error occurs after the initial check THEN the user sees the same guidance. Eligible integration managers can open the provider's detail page directly.
- WHEN Gmail has both credential fields THEN activating the widget uses the existing guarded OAuth initiation.

Frozen by: packages/channel-gmail/src/modules/channel_gmail/__integration__/TC-CHANNEL-EMAIL-006.spec.ts and packages/core/src/modules/communication_channels/backend/profile/communication-channels/__tests__/page.oauthResult.test.tsx

## API Contracts

GET /api/communication_channels/oauth/{provider}/status requires staff authentication and communication_channels.connect_user_channel in the organization used for OAuth. Use the existing authenticated mailbox scope and its tenant fallback. Validate the provider key and require an installed OAuth-capable adapter. The success response contains only the configured boolean. Return 400 for malformed keys, 403 if the caller lacks the feature in the mailbox scope, 404 for unavailable OAuth providers, and 503 if the lookup could not determine readiness. The success response must not be cached.

Status, initiation, and callback select the same OAuth client row. Check the organization row first and fall back to the tenant-wide row if the organization has no client ID. An organization row with a client ID selects that OAuth app. If it lacks a secret that the provider marks as required, treat it as incomplete and keep the organization selection. This prevents a partial organization configuration from silently authorizing with a different tenant-wide OAuth app.

If the selected row is incomplete, status returns configured=false, initiation returns the existing 409 oauth_client_not_configured code, and callback redirects with the same code before exchanging any code. Callback uses the scope bound to the signed OAuth state. If a credential lookup throws and the fallback still does not identify the client, status reports a retryable failure.

This route is additive. Existing OAuth URLs, payloads, authorization checks and cookie behavior remain compatible. No schema migration is needed. The marketplace's category query is an optional initial filter. Unknown values retain the marketplace default. Users can change or clear the initial filter.

## UI/UX

Use the existing DataTable actions and EmptyState on the shared page, with navigation through the existing Button link pattern. Use the existing SocialButton for Gmail and render its state and help inside the same disclosure row. All controls use module translations and the existing semantic styles. Users without integration setup access get administrator guidance. A failed status request remains distinct from missing configuration.

The three pages remain client-rendered at their existing boundaries. The provider widget uses the shared API client and a scope-aware readiness check. The credential resolver and adapter registry stay on the server. No shared provider bootstrap, new UI dependency, or shell change is needed.

## Edge Cases

- When no Gmail provider is installed, no Gmail widget is injected. Other providers continue to use their existing controls.
- An old status response cannot enable a connect control after the active organization changes.
- A fabricated or unknown callback provider cannot produce a navigation link. Callback recovery uses server-confirmed provider availability and encoded path segments.
- Saving client credentials does not establish a mailbox connection. The next status check reflects the saved client, and the user still authorizes their mailbox.

## Implementation Plan

### Phase 1. Link the setup screens

1. Verify the existing Gmail initiation and OAuth callback characterization tests. Add coverage for feature-gated list actions and use the existing marketplace category helpers to accept a valid initial category.

### Phase 2. Show Gmail readiness and recovery

2. Add the authenticated provider-status route and tests for configured, partial, unavailable, organization-scoped and unauthorized cases. Reuse the existing credential resolution order.
3. Consume readiness in the Gmail widget. Keep the initiation mutation guard and add recovery guidance and access-controlled links to the initiation and callback error paths. Add translations for every supported locale.
4. Run the API and Playwright coverage below. Archive the capability and link the source specification.

## Integration coverage

| Surface | Cases |
| --- | --- |
| Provider status and OAuth start | Exercise missing, partial and complete client credentials, denied access, wrong organization, an unavailable provider and no secret values in the response. Verify the ready and partial initiation paths. Unit coverage also checks tenant fallback, incomplete organization selection and callback recovery before token exchange. |
| Shared channels and Integrations | Open the empty list with appropriate grants, follow both actions, and verify the marketplace opens on Communication. Check that users without the relevant permission cannot see each link. |
| Personal channels | Open Connect channel, confirm Gmail is disabled before setup, verify the setup link for managers and guidance for mailbox users, and check that an OAuth configuration failure leaves actionable feedback. Cover configured entry and recovery using self-contained fixtures without sending e-mail or exchanging Google tokens. |
