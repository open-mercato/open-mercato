/**
 * Single source of truth for "does the hub poll this channel?".
 *
 * `ChannelCapabilities.realtimePush` is optional and defaults to `true` for
 * back-compat (chat providers predating the flag omit it), so only an explicit
 * `false` opts a channel into hub-managed polling. The poll worker, the manual
 * `poll-now` route and the profile grid all derive their behaviour from this
 * predicate, so the UI can never label a channel the opposite of what the worker
 * actually does (#4980).
 */
export function isHubPolledChannel(capabilities: unknown): boolean {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return false
  return (capabilities as { realtimePush?: unknown }).realtimePush === false
}
