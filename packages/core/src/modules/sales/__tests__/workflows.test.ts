/**
 * Sales Order Approval Workflow — context contract tests
 *
 * The approval workflow is started by the workflows module's order-approval widget.
 * Every `{{context.*}}` reference the definition interpolates must be a key that
 * start path actually seeds, otherwise the UPDATE_ENTITY activities silently receive
 * an unresolved template string instead of the order id (issue #4334).
 */

import fs from 'node:fs'
import path from 'node:path'
import { workflowsConfig } from '../workflows'

const WIDGET_CLIENT_PATH = path.join(
  __dirname,
  '../../workflows/widgets/injection/order-approval/widget.client.tsx'
)

const CONTEXT_REFERENCE_PATTERN = /\{\{\s*context\.([A-Za-z0-9_$]+)\s*\}\}/g

type ActivityConfig = { config?: Record<string, unknown> }
type Transition = { activities?: ActivityConfig[] }

const orderApproval = workflowsConfig.workflows.find(
  (workflow) => workflow.workflowId === 'sales.order-approval'
)

function collectContextKeys(value: unknown, keys: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(CONTEXT_REFERENCE_PATTERN)) {
      keys.add(match[1])
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectContextKeys(item, keys))
    return
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectContextKeys(item, keys))
  }
}

function transitions(): Transition[] {
  return (orderApproval?.definition?.transitions ?? []) as Transition[]
}

function updateEntityInputs(): Record<string, unknown>[] {
  return transitions()
    .flatMap((transition) => transition.activities ?? [])
    .filter((activity) => (activity as { activityType?: string }).activityType === 'UPDATE_ENTITY')
    .map((activity) => (activity.config?.input ?? {}) as Record<string, unknown>)
}

function widgetInitialContextKeys(): string[] {
  const source = fs.readFileSync(WIDGET_CLIENT_PATH, 'utf8')
  const block = source.match(/initialContext:\s*\{([\s\S]*?)\}/)
  if (!block) throw new Error(`No initialContext literal found in ${WIDGET_CLIENT_PATH}`)
  return block[1]
    .split(',')
    .map((entry) => entry.split(':')[0].trim())
    .filter((entry) => /^[A-Za-z0-9_$]+$/.test(entry))
}

describe('sales.order-approval workflow context contract', () => {
  test('definition is registered', () => {
    expect(orderApproval).toBeDefined()
  })

  test('every UPDATE_ENTITY activity targets the order via context.orderId', () => {
    const inputs = updateEntityInputs()

    expect(inputs.length).toBeGreaterThan(0)
    inputs.forEach((input) => {
      expect(input.id).toBe('{{context.orderId}}')
    })
  })

  test('no activity still references the removed context.id key', () => {
    const keys = new Set<string>()
    collectContextKeys(orderApproval?.definition, keys)

    expect(Array.from(keys)).not.toContain('id')
  })

  test('the widget seeds every context key the UPDATE_ENTITY activities interpolate', () => {
    const seededKeys = widgetInitialContextKeys()
    const referencedKeys = new Set<string>()
    updateEntityInputs().forEach((input) => collectContextKeys(input, referencedKeys))

    expect(referencedKeys.size).toBeGreaterThan(0)
    referencedKeys.forEach((key) => {
      expect(seededKeys).toContain(key)
    })
  })

  test('the event trigger maps the order id onto the same context key', () => {
    const triggers = (orderApproval?.definition as { triggers?: Array<Record<string, any>> })
      ?.triggers ?? []
    const mapping = triggers[0]?.config?.contextMapping ?? []

    expect(mapping).toContainEqual(
      expect.objectContaining({ targetKey: 'orderId', sourceExpression: 'id' })
    )
  })
})
