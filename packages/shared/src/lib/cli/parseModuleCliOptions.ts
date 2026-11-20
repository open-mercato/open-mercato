export type ModuleCliOptionsConfig<FlagValue extends string | boolean | undefined = true> = {
  flagValue?: FlagValue
  trimKeys?: boolean
  skipEmptyKeys?: boolean
  consumeEmptyValues?: boolean
  advancePastValue?: boolean
}

export function parseModuleCliOptions<FlagValue extends string | boolean | undefined = true>(
  tokens: readonly string[],
  config: ModuleCliOptionsConfig<FlagValue> = {},
): Record<string, string | Exclude<FlagValue, undefined>> {
  const options: Record<string, string | Exclude<FlagValue, undefined>> = {}
  const flagValue = Object.prototype.hasOwnProperty.call(config, 'flagValue') ? config.flagValue : true

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token?.startsWith('--')) continue

    const option = token.slice(2)
    const separator = option.indexOf('=')
    const rawKey = separator === -1 ? option : option.slice(0, separator)
    const key = config.trimKeys ? rawKey.trim() : rawKey
    if (config.skipEmptyKeys && !key) continue

    if (separator !== -1) {
      options[key] = option.slice(separator + 1)
      continue
    }

    const next = tokens[index + 1]
    if (next !== undefined && (config.consumeEmptyValues || next !== '') && !next.startsWith('--')) {
      options[key] = next
      if (config.advancePastValue !== false) index += 1
    } else if (flagValue !== undefined) {
      options[key] = flagValue as Exclude<FlagValue, undefined>
    }
  }

  return options
}
