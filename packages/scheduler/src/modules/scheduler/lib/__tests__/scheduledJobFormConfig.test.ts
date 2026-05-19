import * as React from 'react'
import { loadTimezoneOptions, scheduledJobFields } from '../scheduledJobFormConfig'

type AnyElement = React.ReactElement<any, any>

function isElement(node: unknown): node is AnyElement {
  return typeof node === 'object' && node !== null && '$$typeof' in (node as object)
}

function* walk(node: unknown): Generator<AnyElement> {
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child)
    return
  }
  if (!isElement(node)) return
  yield node
  const children = (node.props as { children?: unknown })?.children
  if (children !== undefined) yield* walk(children)
}

function findLabelFor(tree: unknown, htmlFor: string): AnyElement | null {
  for (const el of walk(tree)) {
    const props = el.props as { htmlFor?: string } | undefined
    if (props && props.htmlFor === htmlFor) return el
  }
  return null
}

function hasRequiredAsterisk(label: AnyElement): boolean {
  for (const el of walk(label.props.children)) {
    if (el.type !== 'span') continue
    const className = (el.props as { className?: string }).className ?? ''
    if (!className.includes('text-status-error-icon')) continue
    const children = (el.props as { children?: unknown }).children
    const text = Array.isArray(children) ? children.join('') : String(children ?? '')
    if (text.includes('*')) return true
  }
  return false
}

function renderTargetFields(targetType: 'queue' | 'command'): AnyElement {
  const t = (_key: string, fallback: string) => fallback
  const loaders = {
    loadQueueOptions: async () => [],
    loadCommandOptions: async () => [],
    loadTimezoneOptions: async () => [],
  }
  const fields = scheduledJobFields(t, loaders)
  const targetFields = fields.find((f) => f.id === 'targetFields')
  if (!targetFields || targetFields.type !== 'custom' || !targetFields.component) {
    throw new Error('targetFields custom field not found')
  }
  const Component = targetFields.component as React.FC<any>
  return React.createElement(Component, {
    values: { targetType },
    setFormValue: () => {},
  }) as AnyElement
}

function renderComponent(el: AnyElement): AnyElement {
  const type = el.type as React.FC<any>
  return type(el.props) as AnyElement
}

describe('scheduledJobFormConfig target fields', () => {
  it('marks Target Queue as required with a design-system status asterisk when targetType=queue', () => {
    const tree = renderComponent(renderTargetFields('queue'))
    const label = findLabelFor(tree, 'targetQueue')
    expect(label).not.toBeNull()
    expect(hasRequiredAsterisk(label as AnyElement)).toBe(true)
  })

  it('marks Target Command as required with a design-system status asterisk when targetType=command', () => {
    const tree = renderComponent(renderTargetFields('command'))
    const label = findLabelFor(tree, 'targetCommand')
    expect(label).not.toBeNull()
    expect(hasRequiredAsterisk(label as AnyElement)).toBe(true)
  })

  it('does not render a Target Queue label when targetType=command', () => {
    const tree = renderComponent(renderTargetFields('command'))
    expect(findLabelFor(tree, 'targetQueue')).toBeNull()
  })
})

describe('loadTimezoneOptions', () => {
  it('includes UTC even when Intl.supportedValuesOf does not list it', async () => {
    const options = await loadTimezoneOptions('utc')
    expect(options).toContainEqual({ value: 'UTC', label: 'UTC' })
  })
})
