import type { Node, Edge } from '@xyflow/react'
import type { ValidationError } from './graph-utils'

export type WorkflowValidationIssueSeverity = 'error' | 'warning'

export interface WorkflowValidationIssue {
  id: string
  severity: WorkflowValidationIssueSeverity
  message: string
  nodeId?: string
  edgeId?: string
  nodeLabel?: string
}

export interface ZodIssueLike {
  path: Array<string | number | symbol>
  message: string
}

export interface CollectValidationIssuesInput {
  graphErrors: ValidationError[]
  zodIssues?: ZodIssueLike[]
  configWarnings?: ZodIssueLike[]
  nodes: Node[]
  edges: Edge[]
}

function resolveNodeLabel(node: Node | undefined): string | undefined {
  if (!node) return undefined
  const label = node.data?.label
  return typeof label === 'string' && label.length > 0 ? label : node.id
}

function mapZodPathToGraph(
  path: Array<string | number | symbol>,
  nodes: Node[],
  edges: Edge[],
): { nodeId?: string; edgeId?: string; nodeLabel?: string } {
  const [collection, index] = path
  if (typeof index !== 'number') return {}
  if (collection === 'steps') {
    const node = nodes[index]
    if (!node) return {}
    return { nodeId: node.id, nodeLabel: resolveNodeLabel(node) }
  }
  if (collection === 'transitions') {
    const edge = edges[index]
    if (!edge) return {}
    return { edgeId: edge.id }
  }
  return {}
}

function formatZodPath(path: Array<string | number | symbol>): string {
  return path.map((segment) => String(segment)).join('.')
}

export function collectValidationIssues(input: CollectValidationIssuesInput): WorkflowValidationIssue[] {
  const { graphErrors, zodIssues = [], configWarnings = [], nodes, edges } = input

  const graphIssues: WorkflowValidationIssue[] = graphErrors.map((error, index) => ({
    id: `graph-${index}`,
    severity: error.type,
    message: error.message,
    ...(error.nodeId ? { nodeId: error.nodeId } : {}),
    ...(error.edgeId ? { edgeId: error.edgeId } : {}),
    ...(error.nodeId
      ? { nodeLabel: resolveNodeLabel(nodes.find((node) => node.id === error.nodeId)) }
      : {}),
  }))

  const schemaIssues: WorkflowValidationIssue[] = zodIssues.map((issue, index) => {
    const pathText = formatZodPath(issue.path)
    return {
      id: `schema-${index}`,
      severity: 'error',
      message: pathText ? `${pathText} - ${issue.message}` : issue.message,
      ...mapZodPathToGraph(issue.path, nodes, edges),
    }
  })

  const configWarningIssues: WorkflowValidationIssue[] = configWarnings.map((issue, index) => {
    const pathText = formatZodPath(issue.path)
    return {
      id: `config-${index}`,
      severity: 'warning',
      message: pathText ? `${pathText} - ${issue.message}` : issue.message,
      ...mapZodPathToGraph(issue.path, nodes, edges),
    }
  })

  const all = [...graphIssues, ...schemaIssues, ...configWarningIssues]
  const errors = all.filter((issue) => issue.severity === 'error')
  const warnings = all.filter((issue) => issue.severity === 'warning')
  return [...errors, ...warnings]
}

export function countIssuesBySeverity(issues: WorkflowValidationIssue[]): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const issue of issues) {
    if (issue.severity === 'error') errors += 1
    else warnings += 1
  }
  return { errors, warnings }
}
