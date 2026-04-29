function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toTitleCase(value: string): string {
  return value
    .split(/[\s:_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function deriveLabelFromSourceKind(sourceKind: string | null | undefined): string | null {
  const normalized = readNonEmptyString(sourceKind)
  if (!normalized) return null
  return toTitleCase(normalized)
}

function deriveLabelFromSnapshot(snapshot: Record<string, unknown> | null | undefined): string | null {
  if (!snapshot) return null
  return deriveLabelFromSourceKind(readNonEmptyString(snapshot.sourceKind))
}

function deriveHintFromSnapshot(snapshot: Record<string, unknown> | null | undefined): string | null {
  if (!snapshot) return null

  const sourceLabel = readNonEmptyString(snapshot.sourceLabel)
  if (sourceLabel) return sourceLabel

  const sourceKind = readNonEmptyString(snapshot.sourceKind)
  if (!sourceKind) return null

  return toTitleCase(sourceKind)
}

function deriveHintFromEntityType(sourceEntityType: string | null | undefined): string | null {
  const entityType = readNonEmptyString(sourceEntityType)
  if (!entityType) return null

  const [moduleName] = entityType.split(':')
  if (!moduleName || moduleName === 'inbox_ops') return null

  return toTitleCase(moduleName)
}

export type InboxOpsProposalSourceDisplay = {
  sourceKind: string | null
  sourceLabel: string | null
  sourceHint: string | null
  sourceIcon: string | null
}

export function buildProposalSourceDisplay(args: {
  sourceKind?: string | null
  sourceIcon?: string | null
  sourceEntityType?: string | null
  sourceSnapshot?: Record<string, unknown> | null
  inboxEmailId?: string | null
  legacyInboxEmailId?: string | null
}): InboxOpsProposalSourceDisplay {
  const sourceEntityType = readNonEmptyString(args.sourceEntityType)
  const explicitSourceKind = readNonEmptyString(args.sourceKind)
  const explicitSourceIcon = readNonEmptyString(args.sourceIcon)
  const sourceLabel = deriveLabelFromSourceKind(explicitSourceKind)
    ?? deriveLabelFromSnapshot(args.sourceSnapshot)
    ?? deriveHintFromEntityType(sourceEntityType)
  const sourceHintCandidate = deriveHintFromSnapshot(args.sourceSnapshot) ?? deriveHintFromEntityType(sourceEntityType)
  const sourceHint = sourceHintCandidate === sourceLabel ? null : sourceHintCandidate

  if (explicitSourceKind) {
    return { sourceKind: explicitSourceKind, sourceLabel, sourceHint, sourceIcon: explicitSourceIcon }
  }

  if (
    readNonEmptyString(args.inboxEmailId)
    || readNonEmptyString(args.legacyInboxEmailId)
  ) {
    return {
      sourceKind: 'email',
      sourceLabel: sourceLabel ?? 'Email',
      sourceHint,
      sourceIcon: explicitSourceIcon ?? 'mail',
    }
  }

  return {
    sourceKind: 'other',
    sourceLabel: sourceLabel ?? 'Other',
    sourceHint,
    sourceIcon: explicitSourceIcon,
  }
}
