export type TroubleshootingOption = {
  label: string
  next?: TroubleshootingNode
  resolution?: string
  reasonCode?: string
}

export type TroubleshootingNode = {
  prompt: string
  options: TroubleshootingOption[]
}

export type TroubleshootingGuideMatcher = {
  claimType?: string | null
  reasonCode?: string | null
  isActive: boolean
}

const MAX_TREE_DEPTH = 50

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return requiredText(value) ?? undefined
}

function parseOption(raw: unknown, depth: number, seen: WeakSet<object>): TroubleshootingOption | null {
  if (!isRecord(raw)) return null
  const label = requiredText(raw.label)
  if (!label) return null

  const next = raw.next === undefined || raw.next === null
    ? undefined
    : parseNode(raw.next, depth + 1, seen) ?? null
  if (next === null) return null

  const resolution = optionalText(raw.resolution)
  const reasonCode = optionalText(raw.reasonCode)
  if (!next && resolution === undefined && reasonCode === undefined) return null

  return {
    label,
    ...(next ? { next } : {}),
    ...(resolution !== undefined ? { resolution } : {}),
    ...(reasonCode !== undefined ? { reasonCode } : {}),
  }
}

function parseNode(raw: unknown, depth: number, seen: WeakSet<object>): TroubleshootingNode | null {
  if (depth > MAX_TREE_DEPTH || !isRecord(raw)) return null
  if (seen.has(raw)) return null

  seen.add(raw)
  const prompt = requiredText(raw.prompt)
  const optionsRaw = raw.options
  if (!prompt || !Array.isArray(optionsRaw)) {
    seen.delete(raw)
    return null
  }

  const options: TroubleshootingOption[] = []
  for (const optionRaw of optionsRaw) {
    const option = parseOption(optionRaw, depth, seen)
    if (!option) {
      seen.delete(raw)
      return null
    }
    options.push(option)
  }

  seen.delete(raw)
  return { prompt, options }
}

export function parseGuideSteps(raw: unknown): TroubleshootingNode | null {
  return parseNode(raw, 0, new WeakSet<object>())
}

export function walkGuide(
  root: TroubleshootingNode | null,
  path: number[],
): { node: TroubleshootingNode | null; terminal: { resolution?: string; reasonCode?: string } | null } {
  if (!root) return { node: null, terminal: null }

  let node: TroubleshootingNode | null = root
  for (let index = 0; index < path.length; index += 1) {
    const optionIndex = path[index]
    if (!node || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= node.options.length) {
      return { node: null, terminal: null }
    }

    const option: TroubleshootingOption = node.options[optionIndex]
    if (option.next) {
      node = option.next
      continue
    }

    if (option.resolution !== undefined || option.reasonCode !== undefined) {
      if (index !== path.length - 1) return { node: null, terminal: null }
      return {
        node: null,
        terminal: {
          ...(option.resolution !== undefined ? { resolution: option.resolution } : {}),
          ...(option.reasonCode !== undefined ? { reasonCode: option.reasonCode } : {}),
        },
      }
    }

    return { node: null, terminal: null }
  }

  return { node, terminal: null }
}

export function guideMatches(
  guide: TroubleshootingGuideMatcher,
  claimType?: string | null,
  reasonCode?: string | null,
): boolean {
  if (!guide.isActive) return false
  if (guide.claimType !== null && guide.claimType !== undefined && guide.claimType !== claimType) return false
  if (guide.reasonCode !== null && guide.reasonCode !== undefined && guide.reasonCode !== reasonCode) return false
  return true
}

export function guideMatchSpecificity(guide: Pick<TroubleshootingGuideMatcher, 'claimType' | 'reasonCode'>): number {
  return (guide.claimType ? 1 : 0) + (guide.reasonCode ? 1 : 0)
}

export function selectBestGuide<TGuide extends TroubleshootingGuideMatcher>(
  guides: readonly TGuide[],
  claimType?: string | null,
  reasonCode?: string | null,
): TGuide | null {
  let best: TGuide | null = null
  let bestScore = -1

  for (const guide of guides) {
    if (!guideMatches(guide, claimType, reasonCode)) continue
    const score = guideMatchSpecificity(guide)
    if (score > bestScore) {
      best = guide
      bestScore = score
    }
  }

  return best
}
