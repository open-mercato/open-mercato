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
