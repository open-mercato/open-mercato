/**
 * `Message.sourceEntityType` sentinels written by `communication_channels` for
 * messages it composes on the platform's behalf. Owned here (not in
 * `communication_channels`) because `messages` is a hard dependency of
 * `communication_channels` (it imports the `Message` entity directly), while
 * `communication_channels` is an optional dependency of `messages` — see
 * `resolveComposeSourceChannelType`'s `tryResolveChannelTypeService`. A
 * constant defined here can be imported by `communication_channels` without
 * creating the reverse, forbidden coupling.
 */
export const SEND_AS_USER_SOURCE_ENTITY_TYPE = 'communication_channels.send_as_user'
export { EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE } from './composeSourceChannelType'
