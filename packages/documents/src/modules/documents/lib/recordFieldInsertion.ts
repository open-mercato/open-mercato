import type { Editor, JSONContent } from '@tiptap/core'
import { sanitizeDocumentsDisplayLabel } from './displayLabels'

export type RecordFieldSnapshot = {
  field: string
  label: string
  value: string
}

export function normalizeRecordFieldSnapshots(
  fields: readonly RecordFieldSnapshot[],
): RecordFieldSnapshot[] {
  const normalized = new Map<string, RecordFieldSnapshot>()
  for (const field of fields) {
    const key = field.field.trim()
    const label = sanitizeDocumentsDisplayLabel(field.label)
    const value = sanitizeDocumentsDisplayLabel(field.value)
    if (!key || !label || !value || normalized.has(key)) continue
    normalized.set(key, { field: key, label, value })
  }
  return Array.from(normalized.values())
}

function text(value: string, bold = false): JSONContent {
  return {
    type: 'text',
    text: value,
    ...(bold ? { marks: [{ type: 'bold' }] } : {}),
  }
}

function paragraph(field: RecordFieldSnapshot): JSONContent {
  return {
    type: 'paragraph',
    content: [text(field.label, true), text(`: ${field.value}`)],
  }
}

function tableCell(value: string, bold = false): JSONContent {
  return {
    type: 'tableCell',
    content: [{ type: 'paragraph', content: [text(value, bold)] }],
  }
}

export function buildRecordFieldSnapshotContent(
  input: readonly RecordFieldSnapshot[],
): JSONContent[] {
  const fields = normalizeRecordFieldSnapshots(input)
  if (fields.length === 0) return []
  if (fields.length === 1) return [paragraph(fields[0]!)]
  return [
    {
      type: 'table',
      content: fields.map((field) => ({
        type: 'tableRow',
        content: [tableCell(field.label, true), tableCell(field.value)],
      })),
    },
    { type: 'paragraph' },
  ]
}

export function insertRecordFieldSnapshot(
  editor: Editor | null,
  fields: readonly RecordFieldSnapshot[],
): boolean {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false
  const content = buildRecordFieldSnapshotContent(fields)
  if (content.length === 0) return false
  return editor.chain().focus().insertContent(content).run()
}
