import { createHash } from 'node:crypto'

export const MAX_HARNESS_READ_BYTES = 256 * 1024

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function deliveryError(details) {
  return {
    content: [{ type: 'text', text: '[internal] Harness read delivery failed: expected one original text block within 262144 UTF-8 bytes.' }],
    details,
    isError: true,
  }
}

export function restoreHarnessReadResult(event) {
  if (!isRecord(event) || event.type !== 'tool_result' || event.toolName !== 'mcp__harness__read'
    || event.isError !== false || !isRecord(event.details)
    || event.details.server !== 'harness' || event.details.tool !== 'read') return undefined

  const original = event.structuredContent
  if (isRecord(original) && original.isError === true) return undefined
  if (!isRecord(original) || (original.isError !== undefined && original.isError !== false)
    || !Array.isArray(original.content) || original.content.length !== 1) return deliveryError(event.details)

  const block = original.content[0]
  if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string'
    || Object.keys(block).some(key => !['type', 'text'].includes(key))
    || block.text.length > MAX_HARNESS_READ_BYTES) return deliveryError(event.details)

  const bytes = Buffer.byteLength(block.text, 'utf8')
  if (bytes > MAX_HARNESS_READ_BYTES) return deliveryError(event.details)

  return {
    content: [{ type: 'text', text: block.text }],
    structuredContent: original,
    details: {
      ...event.details,
      harnessReadDelivery: { bytes, sha256: createHash('sha256').update(block.text, 'utf8').digest('hex') },
    },
    isError: false,
  }
}

export default function piHarnessExtension(pi) {
  pi.on('tool_result', restoreHarnessReadResult)
}
