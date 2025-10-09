export type OrganizationTreeNode = {
  id: string
  name: string
  depth?: number
  pathLabel?: string
  selectable?: boolean
  isActive?: boolean
  children?: OrganizationTreeNode[]
}

export type OrganizationTreeOption = {
  value: string
  name: string
  depth: number
  pathLabel?: string
  isActive?: boolean
}

export function formatOrganizationTreeLabel(name: string, depth: number): string {
  if (depth <= 0) return name
  const indent = '\u00A0'.repeat(Math.max(0, (depth - 1) * 2))
  return `${indent}↳ ${name}`
}

export function buildOrganizationTreeOptions(
  nodes: OrganizationTreeNode[],
  exclude: Set<string> = new Set(),
  acc: OrganizationTreeOption[] = [],
  depth = 0
): OrganizationTreeOption[] {
  for (const node of nodes) {
    const nodeDepth = typeof node.depth === 'number' ? node.depth : depth
    if (!exclude.has(node.id)) {
      acc.push({
        value: node.id,
        name: node.name,
        depth: nodeDepth,
        pathLabel: node.pathLabel,
        isActive: node.isActive,
      })
    }
    if (node.children && node.children.length) {
      buildOrganizationTreeOptions(node.children, exclude, acc, nodeDepth + 1)
    }
  }
  return acc
}
