"use server"

export type AttachmentAssignment = {
  type: string
  id: string
  href?: string | null
  label?: string | null
}

export type AttachmentMetadata = {
  tags?: string[]
  assignments?: AttachmentAssignment[]
  [key: string]: unknown
}

type Dict = Record<string, unknown>

function isDict(value: unknown): value is Dict {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeString(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

export function normalizeAttachmentTags(input: unknown): string[] {
  if (!input) return []
  const values: string[] = Array.isArray(input)
    ? input.map((entry) => normalizeString(entry))
    : typeof input === 'string'
      ? input
          .split(',')
          .map((entry) => normalizeString(entry))
      : []
  const unique = new Set(values.filter((entry) => entry.length > 0))
  return Array.from(unique.values())
}

function normalizeAssignment(entry: unknown): AttachmentAssignment | null {
  if (!isDict(entry)) return null
  const type = normalizeString(entry.type)
  const id = normalizeString(entry.id)
  if (!type || !id) return null
  const assignment: AttachmentAssignment = { type, id }
  const href = normalizeString(entry.href)
  if (href) assignment.href = href
  else if (entry.href === null) assignment.href = null
  const label = normalizeString(entry.label)
  if (label) assignment.label = label
  return assignment
}

export function normalizeAttachmentAssignments(input: unknown): AttachmentAssignment[] {
  if (!input) return []
  const entries = Array.isArray(input) ? input : isDict(input) ? [input] : []
  const map = new Map<string, AttachmentAssignment>()
  for (const entry of entries) {
    const normalized = normalizeAssignment(entry)
    if (!normalized) continue
    const key = `${normalized.type}:${normalized.id}`
    map.set(key, normalized)
  }
  return Array.from(map.values())
}

export function readAttachmentMetadata(raw: unknown): AttachmentMetadata {
  const base = isDict(raw) ? { ...raw } : {}
  const assignments = normalizeAttachmentAssignments(base.assignments)
  const tags = normalizeAttachmentTags(base.tags)
  return {
    ...base,
    assignments,
    tags,
  }
}

export function mergeAttachmentMetadata(
  raw: unknown,
  patch: Partial<Pick<AttachmentMetadata, 'assignments' | 'tags'>>,
): AttachmentMetadata {
  const base = readAttachmentMetadata(raw)
  if (patch.assignments) base.assignments = normalizeAttachmentAssignments(patch.assignments)
  if (patch.tags) base.tags = normalizeAttachmentTags(patch.tags)
  return base
}

export function upsertAssignment(
  assignments: AttachmentAssignment[],
  entry: AttachmentAssignment | null | undefined,
): AttachmentAssignment[] {
  if (!entry) return assignments
  const key = `${entry.type}:${entry.id}`
  const map = new Map(assignments.map((candidate) => [`${candidate.type}:${candidate.id}`, candidate] as const))
  map.set(key, entry)
  return Array.from(map.values())
}

