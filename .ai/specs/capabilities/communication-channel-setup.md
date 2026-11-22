# Communication channel setup

Source: [Communication channel setup navigation](../2026-11-22-communication-channel-setup.md) and [issue #6172](https://github.com/open-mercato/open-mercato/issues/6172).

## Requirement: Find the next setup step from shared channels

- WHEN a user has integrations.view THEN Configure providers opens the Communication category in Integrations.
- WHEN a user has communication_channels.connect_user_channel THEN Connect my mailbox opens their personal channels.
- WHEN the list is empty THEN its empty state provides the same actions with the same ACL checks.

## Requirement: Start the personal OAuth mailbox connection

- WHEN the Gmail OAuth client is unconfigured in the current workspace THEN the Gmail button is disabled and explains the setup it needs.
- WHEN the user can view and manage integrations THEN the guidance links to the provider's integration detail.
- WHEN configuration is present THEN the Gmail button uses the existing guarded OAuth initiation.
- WHEN OAuth returns a configuration error THEN recovery guidance remains available on the profile page or beside the Gmail button.

## Verification

- [Scoped OAuth readiness API](../../packages/channel-gmail/src/modules/channel_gmail/__integration__/TC-CHANNEL-EMAIL-033-oauth-setup-status.spec.ts)
- [Setup and recovery browser flow](../../packages/channel-gmail/src/modules/channel_gmail/__integration__/TC-CHANNEL-EMAIL-034-oauth-setup-navigation.spec.ts)
