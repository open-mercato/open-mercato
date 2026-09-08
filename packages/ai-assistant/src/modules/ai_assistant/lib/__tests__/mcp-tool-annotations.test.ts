import { z } from 'zod'
import { buildMcpToolAnnotations } from '../mcp-tool-annotations'
import type { AiToolDefinition } from '../types'

function makeTool(overrides: Partial<AiToolDefinition> = {}): AiToolDefinition {
  return {
    name: 'customers.get_company',
    description: 'Fetch a single company record.',
    inputSchema: z.object({ id: z.string() }),
    handler: async () => ({}),
    ...overrides,
  } as AiToolDefinition
}

describe('buildMcpToolAnnotations', () => {
  it('advertises readOnlyHint for tools that do not declare a mutation', () => {
    expect(buildMcpToolAnnotations(makeTool())).toEqual({ readOnlyHint: true })
  })

  it('advertises readOnlyHint for tools that explicitly declare isMutation: false', () => {
    expect(buildMcpToolAnnotations(makeTool({ isMutation: false }))).toEqual({ readOnlyHint: true })
  })

  it('never advertises readOnlyHint for mutating tools', () => {
    expect(buildMcpToolAnnotations(makeTool({ isMutation: true }))).toEqual({ readOnlyHint: false })
  })

  it('advertises destructiveHint when the mutation declares isDestructive', () => {
    expect(buildMcpToolAnnotations(makeTool({ isMutation: true, isDestructive: true }))).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
    })
  })

  it('carries an explicit non-destructive declaration through', () => {
    expect(buildMcpToolAnnotations(makeTool({ isMutation: true, isDestructive: false }))).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
    })
  })

  it('resolves a per-input isDestructive predicate to true rather than under-warning', () => {
    const annotations = buildMcpToolAnnotations(
      makeTool({ isMutation: true, isDestructive: (input: unknown) => (input as { op: string }).op === 'delete' }),
    )
    expect(annotations).toEqual({ readOnlyHint: false, destructiveHint: true })
  })

  it('omits destructiveHint when a mutation does not declare isDestructive', () => {
    expect(buildMcpToolAnnotations(makeTool({ isMutation: true }))).not.toHaveProperty('destructiveHint')
  })

  it('never advertises idempotentHint, which no tool definition carries', () => {
    expect(buildMcpToolAnnotations(makeTool())).not.toHaveProperty('idempotentHint')
    expect(buildMcpToolAnnotations(makeTool({ isMutation: true }))).not.toHaveProperty('idempotentHint')
  })
})
