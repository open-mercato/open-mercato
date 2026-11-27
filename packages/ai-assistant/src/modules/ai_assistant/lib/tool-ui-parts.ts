import { createLogger } from '@open-mercato/shared/lib/logger'
import type { AiToolEmittedUiPart, AiToolUiPartCollector, AiToolUiPartInput } from './types'

const logger = createLogger('ai_assistant').child({ component: 'tool-ui-parts' })

export interface AiToolUiPartBuffer extends AiToolUiPartCollector {
  drain: () => AiToolEmittedUiPart[]
}

function normalizeUiPart(part: AiToolUiPartInput): AiToolEmittedUiPart | null {
  if (!part || typeof part.componentId !== 'string' || part.componentId.length === 0) return null
  const payload = part.payload !== undefined ? part.payload : part.props
  return payload === undefined
    ? { componentId: part.componentId }
    : { componentId: part.componentId, payload }
}

export function createToolUiPartBuffer(): AiToolUiPartBuffer {
  const buffer: AiToolEmittedUiPart[] = []
  return {
    enqueue: (part) => {
      const normalized = normalizeUiPart(part)
      if (normalized) buffer.push(normalized)
    },
    drain: () => buffer.splice(0, buffer.length),
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mergeUiPartsIntoToolResult(
  result: unknown,
  parts: AiToolEmittedUiPart[],
): unknown {
  if (parts.length === 0) return result
  if (isPlainObject(result)) {
    const existing = result.uiParts
    if (existing === undefined || existing === null) return { ...result, uiParts: parts }
    if (Array.isArray(existing)) return { ...result, uiParts: [...existing, ...parts] }
    logger.warn('Tool result has a non-array uiParts field; emitted UI parts were dropped', {
      componentIds: parts.map((part) => part.componentId),
    })
    return result
  }
  return { result: result === undefined ? null : result, uiParts: parts }
}
