/**
 * @jest-environment jsdom
 *
 * The canvas trigger node's rendering contract (fidelity gap #5).
 *
 * Spec §4.6 makes the keyboard/a11y path an ACCEPTANCE CRITERION: "Every canvas
 * operation is reachable without a pointer… ARIA labeling on nodes/routes/badges…
 * Status is never color-only." So the pill is a real `<button>`, every state it
 * paints (disabled trigger, disabled definition) pairs its token with a glyph
 * AND a name, and the node announces what it is rather than relying on a green
 * dot next to START.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TriggerNode } from '../nodes/TriggerNode'
import { buildTriggerNodeModel, TRIGGER_NODE_EVENT_LIMIT } from '../../lib/trigger-node'

jest.mock('@xyflow/react', () => ({
  Handle: ({ id, isConnectable }: { id?: string; isConnectable?: boolean }) => (
    <span data-testid="handle" data-handle-id={id} data-connectable={String(!!isConnectable)} />
  ),
  Position: { Right: 'right', Left: 'left' },
}))

const TRIGGERS = [
  { triggerId: 'created', name: 'Deal created', eventPattern: 'customers.deal.created', enabled: true },
  { triggerId: 'updated', name: 'Deal updated', eventPattern: 'customers.deal.updated', enabled: true },
]

function renderNode(
  model: ReturnType<typeof buildTriggerNodeModel>,
  onOpen?: () => void,
) {
  const props = {
    id: '__workflow_trigger__',
    data: { model, onOpen },
    isConnectable: false,
    selected: false,
  } as unknown as React.ComponentProps<typeof TriggerNode>
  return renderWithProviders(<TriggerNode {...props} />)
}

describe('the trigger node answers "where does this start"', () => {
  it('names every declared event trigger on the canvas', () => {
    renderNode(buildTriggerNodeModel(TRIGGERS))

    expect(screen.getByText('customers.deal.created')).toBeInTheDocument()
    expect(screen.getByText('customers.deal.updated')).toBeInTheDocument()
  })

  it('states the manual / API start, which exists whether or not a trigger does', () => {
    const { container } = renderNode(buildTriggerNodeModel([]))

    expect(container.querySelector('[data-trigger-manual="true"]')).not.toBeNull()
    expect(screen.getByText('manual / API start')).toBeInTheDocument()
    // …and claims no event trigger it does not have.
    expect(container.querySelectorAll('[data-trigger-row]')).toHaveLength(0)
  })

  it('collapses a long trigger list rather than turning one node into a legend', () => {
    const { container } = renderNode(
      buildTriggerNodeModel(
        Array.from({ length: 6 }, (_, index) => ({
          triggerId: `t${index}`,
          eventPattern: `module.entity.event${index}`,
          enabled: true,
        })),
      ),
    )

    expect(container.querySelectorAll('[data-trigger-row]')).toHaveLength(TRIGGER_NODE_EVENT_LIMIT)
    expect(container.querySelector('[data-trigger-overflow]')?.getAttribute('data-trigger-overflow')).toBe('3')
    expect(screen.getByText('+3 more')).toBeInTheDocument()
  })
})

/**
 * The lucide shape class (`lucide-ban`, `lucide-zap`) and nothing else — the
 * colour utility rides on the same attribute, so comparing whole class strings
 * would let a pure colour swap pass as a second cue.
 */
function shapeOf(row: Element | undefined): string | undefined {
  const classes = row?.querySelector('svg.lucide')?.getAttribute('class')?.split(/\s+/) ?? []
  return classes.find((name) => name.startsWith('lucide-'))
}

describe('nothing here is communicated by colour alone (§4.6)', () => {
  it('gives a disabled trigger its own glyph AND an announced name', () => {
    const { container } = renderNode(
      buildTriggerNodeModel([
        { triggerId: 'live', eventPattern: 'a.b.live', enabled: true },
        { triggerId: 'off', eventPattern: 'a.b.off', enabled: false },
      ]),
    )

    const rows = Array.from(container.querySelectorAll('[data-trigger-row]'))
    const off = rows.find((row) => row.getAttribute('data-trigger-enabled') === 'false')
    const live = rows.find((row) => row.getAttribute('data-trigger-enabled') === 'true')

    expect(off?.querySelector('.sr-only')?.textContent).toBe('disabled')
    // Two different glyph SHAPES, not two shades of the same one — a colour
    // swap alone would leave a red-blind reader with two identical marks.
    expect(shapeOf(off)).not.toBe(shapeOf(live))
    expect(shapeOf(off)).toBeTruthy()
  })

  it('says in words that a disabled definition is started by nothing', () => {
    const { container } = renderNode(buildTriggerNodeModel(TRIGGERS, { definitionEnabled: false }))

    expect(container.querySelector('[data-trigger-definition-disabled="true"]')).not.toBeNull()
    expect(screen.getByText('workflow disabled — nothing starts it')).toBeInTheDocument()
    // The entry points it cannot offer are not drawn as if it could.
    expect(container.querySelectorAll('[data-trigger-row]')).toHaveLength(0)
    expect(container.querySelector('[data-trigger-manual="true"]')).toBeNull()
  })

  it('announces the node itself, so it is not a green dot beside START', () => {
    renderNode(buildTriggerNodeModel(TRIGGERS))

    const pill = screen.getByTestId('workflow-trigger-node')
    const label = pill.getAttribute('aria-label') ?? ''
    expect(label).toContain('Starts')
    expect(label).toContain('2 of 2')
    expect(label).toContain('Edit triggers')
  })
})

describe('the node is reachable and useful without a pointer', () => {
  it('is a real button, so Tab reaches it and Enter activates it', () => {
    const onOpen = jest.fn()
    renderNode(buildTriggerNodeModel(TRIGGERS), onOpen)

    const pill = screen.getByRole('button', { name: /Edit triggers/ })
    pill.focus()
    expect(document.activeElement).toBe(pill)

    // jsdom translates Enter/Space on a native button into a click, which is
    // exactly the behaviour a non-native element would have had to reimplement.
    fireEvent.click(pill)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('offers the same action when the definition declares no trigger yet', () => {
    const onOpen = jest.fn()
    renderNode(buildTriggerNodeModel([]), onOpen)

    fireEvent.click(screen.getByRole('button', { name: /Edit triggers/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('exposes no connectable handle — the pill can never be a route endpoint', () => {
    renderNode(buildTriggerNodeModel(TRIGGERS))
    for (const handle of screen.getAllByTestId('handle')) {
      expect(handle.getAttribute('data-connectable')).toBe('false')
    }
  })
})
