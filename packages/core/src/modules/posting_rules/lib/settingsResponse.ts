export type PostingRulesSettingsData = {
  settingsId: string
  clearingAccountId: string | null
  unallocatedCostAccountId: string | null
  updatedAt: string | null
}

export type PostingRulesSettingsPatch = {
  clearingAccountId?: string | null
  unallocatedCostAccountId?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * `GET`/`PATCH /api/posting_rules/settings` answer `{ ok, result: {...} }`,
 * and `apiCall().result` is that whole body, so the settings live one level
 * down. Returns `null` when the body has no settings object.
 */
export function unwrapSettingsResult(body: unknown): PostingRulesSettingsData | null {
  if (!isRecord(body) || !isRecord(body.result)) return null
  const result = body.result
  return {
    settingsId: typeof result.settingsId === 'string' ? result.settingsId : '',
    clearingAccountId: readNullableString(result.clearingAccountId),
    unallocatedCostAccountId: readNullableString(result.unallocatedCostAccountId),
    updatedAt: readNullableString(result.updatedAt),
  }
}

/**
 * Only the fields the user changed. The `PATCH` command leaves an absent
 * field untouched, so saving one account never writes `null` into the other.
 */
export function buildSettingsPatch(
  current: Pick<PostingRulesSettingsData, 'clearingAccountId' | 'unallocatedCostAccountId'>,
  values: Record<string, unknown>,
): PostingRulesSettingsPatch {
  const patch: PostingRulesSettingsPatch = {}
  const clearingAccountId = readNullableString(values.clearingAccountId)
  const unallocatedCostAccountId = readNullableString(values.unallocatedCostAccountId)
  if (clearingAccountId !== current.clearingAccountId) patch.clearingAccountId = clearingAccountId
  if (unallocatedCostAccountId !== current.unallocatedCostAccountId) patch.unallocatedCostAccountId = unallocatedCostAccountId
  return patch
}
