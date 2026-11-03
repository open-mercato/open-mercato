/** @jest-environment node */

/**
 * Step 2.12: every shipped workflow-definition example under `examples/` must be
 * a complete, valid definition — including the 60-node OZE density fixture the
 * spec makes an explicit Phase 3 QA scenario ("a 60-node OZE-scale flow with 5
 * agent nodes remains navigable").
 *
 * Rule-set examples (plain business-rule arrays) live in the same folder and are
 * not definitions; they are identified and skipped by shape, so a new example
 * is covered automatically without editing a list.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { workflowDefinitionDataSchema } from '../../data/validators'
import { definitionToGraph, nodeFootprint, validateWorkflowGraph } from '../graph-utils'
import { collectValidationIssues, countIssuesBySeverity } from '../collect-validation-issues'
import { buildRouteChipModel, routeCarriesCondition, ROUTE_CHIP_LIMIT } from '../route-chips'

const examplesDir = join(__dirname, '..', '..', 'examples')

export const DENSITY_FIXTURE_FILE = 'oze-residential-install-60-nodes.json'

type ExampleDocument = {
  workflowId?: unknown
  workflowName?: unknown
  definition?: { steps?: unknown; transitions?: unknown }
}

function readExample(fileName: string): unknown {
  return JSON.parse(readFileSync(join(examplesDir, fileName), 'utf8'))
}

function isDefinitionExample(value: unknown): value is Required<ExampleDocument> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const definition = (value as ExampleDocument).definition
  return Boolean(definition && typeof definition === 'object' && Array.isArray(definition.steps))
}

const exampleFiles = readdirSync(examplesDir).filter((name) => name.endsWith('.json'))
const definitionFiles = exampleFiles.filter((name) => isDefinitionExample(readExample(name)))

describe('workflow definition examples', () => {
  it('discovers the shipped examples, including the density fixture', () => {
    expect(definitionFiles.length).toBeGreaterThan(0)
    expect(definitionFiles).toContain(DENSITY_FIXTURE_FILE)
  })

  describe.each(definitionFiles)('%s', (fileName) => {
    const document = readExample(fileName) as Required<ExampleDocument>

    it('passes workflowDefinitionDataSchema', () => {
      const result = workflowDefinitionDataSchema.safeParse(document.definition)
      if (!result.success) {
        throw new Error(
          `${fileName} failed schema validation:\n${result.error.issues
            .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
            .join('\n')}`,
        )
      }
      expect(result.success).toBe(true)
    })

    it('produces a graph with no blocking structural errors', () => {
      const { nodes, edges } = definitionToGraph(document.definition as never, { autoLayout: false })
      const blocking = validateWorkflowGraph(nodes, edges).filter((issue) => issue.type === 'error')
      expect(blocking).toEqual([])
    })
  })
})

describe('60-node density fixture', () => {
  const document = readExample(DENSITY_FIXTURE_FILE) as Required<ExampleDocument>
  const definition = document.definition as { steps: unknown[]; transitions: unknown[] }

  it('ships sixty steps with five agent touchpoints', () => {
    expect(definition.steps).toHaveLength(60)
    const agentSteps = (definition.steps as Array<{ activities?: Array<{ activityType?: string }> }>).filter((step) =>
      (step.activities ?? []).some((activity) => activity.activityType === 'INVOKE_AGENT'),
    )
    expect(agentSteps).toHaveLength(5)
  })

  it('exercises the chip surfaces: conditions, an overflowing activity route, error routes and a default route', () => {
    const { edges } = definitionToGraph(definition as never, { autoLayout: false })

    const models = edges.map((edge) => ({
      id: edge.id,
      model: buildRouteChipModel({
        condition: edge.data?.condition,
        preConditions: edge.data?.preConditions,
        activities: edge.data?.activities,
        hasConditionedSibling: edges.some(
          (other) => other.source === edge.source && other.id !== edge.id && routeCarriesCondition(other.data ?? {}),
        ),
      }),
    }))

    expect(models.filter((entry) => entry.model.conditionSummary !== null).length).toBeGreaterThanOrEqual(5)
    expect(models.filter((entry) => entry.model.isOtherwise).length).toBeGreaterThanOrEqual(2)
    expect(models.some((entry) => entry.model.overflowCount > 0)).toBe(true)
    expect(models.every((entry) => entry.model.activities.length <= ROUTE_CHIP_LIMIT)).toBe(true)
    expect(edges.filter((edge) => edge.data?.kind === 'error')).toHaveLength(3)
  })

  it('auto-arranges sixty nodes without a single overlapping card', () => {
    // The spec's Phase 3 QA scenario: "a 60-node OZE-scale flow with 5 agent
    // nodes remains navigable". Node geometry changes (the accent cap, the
    // terminal pills) feed `nodeFootprint`, and an under-reserved footprint
    // shows up here as ranks packed tight enough to overlap.
    const { nodes } = definitionToGraph(definition as never, { autoLayout: true })
    expect(nodes).toHaveLength(60)

    const boxes = nodes.map((node) => {
      const step = (definition.steps as Array<{ stepId: string }>).find((candidate) => candidate.stepId === node.id)
      const { width, height } = nodeFootprint({ ...step, nodeType: node.type })
      return {
        id: node.id,
        left: node.position.x,
        top: node.position.y,
        right: node.position.x + width,
        bottom: node.position.y + height,
      }
    })

    const collisions: string[] = []
    for (let outer = 0; outer < boxes.length; outer += 1) {
      for (let inner = outer + 1; inner < boxes.length; inner += 1) {
        const a = boxes[outer]
        const b = boxes[inner]
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          collisions.push(`${a.id} ∩ ${b.id}`)
        }
      }
    }
    expect(collisions).toEqual([])
  })

  it('reserves a smaller footprint for its terminals than for its steps', () => {
    const start = (definition.steps as Array<{ stepId: string; stepType: string }>).find((step) => step.stepType === 'START')!
    const automated = (definition.steps as Array<{ stepId: string; stepType: string }>).find((step) => step.stepType === 'AUTOMATED')!

    expect(nodeFootprint(start).height).toBeLessThan(nodeFootprint(automated).height)
  })

  it('surfaces no flow-logic warnings of its own', () => {
    const { nodes, edges } = definitionToGraph(definition as never, { autoLayout: false })
    const issues = collectValidationIssues({
      graphErrors: validateWorkflowGraph(nodes, edges).filter((issue) => issue.type === 'error'),
      nodes,
      edges,
      definition,
    })
    expect(countIssuesBySeverity(issues)).toEqual({ errors: 0, warnings: 0 })
  })
})
