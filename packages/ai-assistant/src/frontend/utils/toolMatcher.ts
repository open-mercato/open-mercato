import type { ToolInfo } from '../types'

function normalizeString(str: string): string {
  return str.toLowerCase().replace(/[._-]/g, ' ')
}

function fuzzyMatch(query: string, target: string): boolean {
  const normalizedQuery = normalizeString(query)
  const normalizedTarget = normalizeString(target)

  // Check if all query chars appear in order in target
  let queryIndex = 0
  for (let i = 0; i < normalizedTarget.length && queryIndex < normalizedQuery.length; i++) {
    if (normalizedTarget[i] === normalizedQuery[queryIndex]) {
      queryIndex++
    }
  }
  return queryIndex === normalizedQuery.length
}

function scoreMatch(query: string, tool: ToolInfo): number {
  const normalizedQuery = normalizeString(query)
  const normalizedName = normalizeString(tool.name)
  const normalizedDesc = normalizeString(tool.description)

  let score = 0

  // Exact match in name = highest score
  if (normalizedName.includes(normalizedQuery)) {
    score += 100
  }

  // Starts with query
  if (normalizedName.startsWith(normalizedQuery)) {
    score += 50
  }

  // Word boundary match
  const nameWords = normalizedName.split(' ')
  if (nameWords.some((word) => word.startsWith(normalizedQuery))) {
    score += 30
  }

  // Fuzzy match in name
  if (fuzzyMatch(normalizedQuery, normalizedName)) {
    score += 20
  }

  // Match in description
  if (normalizedDesc.includes(normalizedQuery)) {
    score += 10
  }

  return score
}

export function filterTools(tools: ToolInfo[], query: string): ToolInfo[] {
  if (!query.trim()) {
    return tools
  }

  const normalizedQuery = query.trim().toLowerCase()

  // Score and filter tools
  const scoredTools = tools
    .map((tool) => ({
      tool,
      score: scoreMatch(normalizedQuery, tool),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)

  return scoredTools.map(({ tool }) => tool)
}

export function groupToolsByModule(tools: ToolInfo[]): Map<string, ToolInfo[]> {
  const grouped = new Map<string, ToolInfo[]>()

  for (const tool of tools) {
    const module = tool.module || extractModuleFromName(tool.name)
    const existing = grouped.get(module) || []
    existing.push(tool)
    grouped.set(module, existing)
  }

  return grouped
}

function extractModuleFromName(name: string): string {
  const parts = name.split('.')
  return parts[0] || 'other'
}

export function humanizeToolName(name: string): string {
  // customers.people.create -> Create Person
  const parts = name.split('.')
  if (parts.length < 2) return name

  const action = parts[parts.length - 1]
  const resource = parts[parts.length - 2]

  const humanAction = capitalize(action)
  const humanResource = singularize(humanize(resource))

  return `${humanAction} ${humanResource}`
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function humanize(str: string): string {
  return str.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
}

function singularize(str: string): string {
  if (str.endsWith('ies')) {
    return str.slice(0, -3) + 'y'
  }
  if (str.endsWith('es') && !str.endsWith('ses')) {
    return str.slice(0, -2)
  }
  if (str.endsWith('s') && !str.endsWith('ss')) {
    return str.slice(0, -1)
  }
  return str
}
