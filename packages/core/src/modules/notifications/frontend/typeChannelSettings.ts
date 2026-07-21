/**
 * Next eligibility set after toggling one channel in the admin type-catalogue
 * table, based on the EFFECTIVE set (tenant override ?? code ?? all registered
 * channels) — the stored array replaces the code-declared set wholesale.
 */
export function computeNextChannels(
  effective: string[],
  channelId: string,
  enabled: boolean,
): string[] {
  return enabled
    ? Array.from(new Set([...effective, channelId]))
    : effective.filter((channel) => channel !== channelId)
}

/**
 * The `channels` value to PATCH after one toggle: the next eligibility set, or `null` when the
 * toggle empties it (unchecking the last channel). Persisting `[]` would black-hole the type
 * (invisible + undelivered) and is rejected by the API — `null` clears the override so the
 * code-declared default reapplies.
 */
export function computeChannelsPatch(
  effective: string[],
  channelId: string,
  enabled: boolean,
): string[] | null {
  const next = computeNextChannels(effective, channelId, enabled)
  return next.length > 0 ? next : null
}
