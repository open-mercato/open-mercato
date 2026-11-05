export type CategoryTreeNode = {
  id: string
  name: string
  depth?: number
  pathLabel?: string
  isActive?: boolean
  selectable?: boolean
  children?: CategoryTreeNode[]
}

export function formatCategoryTreeLabel(name: string, depth: number): string {
  if (depth <= 0) return name
  const indent = '\u00A0'.repeat(Math.max(0, (depth - 1) * 2))
  return `${indent}↳ ${name}`
}
