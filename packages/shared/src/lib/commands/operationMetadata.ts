export type OperationMetadataPayload = {
  id: string
  undoToken: string
  commandId: string
  actionLabel: string | null
  resourceKind: string | null
  resourceId: string | null
  executedAt: string
}

const HEADER_PREFIX = 'omop:'

export function serializeOperationMetadata(payload: OperationMetadataPayload): string {
  const encoded = encodeURIComponent(JSON.stringify(payload))
  return `${HEADER_PREFIX}${encoded}`
}

export function deserializeOperationMetadata(value: string | null | undefined): OperationMetadataPayload | null {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.startsWith(HEADER_PREFIX) ? value.slice(HEADER_PREFIX.length) : value
  try {
    const parsed = JSON.parse(decodeURIComponent(trimmed))
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.id !== 'string' || typeof parsed.commandId !== 'string') return null
    if (typeof parsed.undoToken !== 'string' || !parsed.undoToken) return null
    if (typeof parsed.executedAt !== 'string') return null
    return {
      id: parsed.id,
      undoToken: parsed.undoToken,
      commandId: parsed.commandId,
      actionLabel: parsed.actionLabel ?? null,
      resourceKind: parsed.resourceKind ?? null,
      resourceId: parsed.resourceId ?? null,
      executedAt: parsed.executedAt,
    }
  } catch {
    return null
  }
}

