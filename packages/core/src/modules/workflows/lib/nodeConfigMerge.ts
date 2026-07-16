function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function mergeAdvancedNodeConfig(
  updates: Record<string, unknown>,
  advancedConfig: unknown,
  options: { nodeType?: string } = {},
) {
  if (!isPlainRecord(advancedConfig)) return

  const { userTaskConfig, ...advancedFields } = advancedConfig
  Object.assign(updates, advancedFields)

  if (userTaskConfig === undefined) return

  if (
    options.nodeType === 'userTask' &&
    isPlainRecord(userTaskConfig) &&
    isPlainRecord(updates.userTaskConfig)
  ) {
    updates.userTaskConfig = {
      ...userTaskConfig,
      ...updates.userTaskConfig,
    }
    return
  }

  if (updates.userTaskConfig === undefined) {
    updates.userTaskConfig = userTaskConfig
  }
}
