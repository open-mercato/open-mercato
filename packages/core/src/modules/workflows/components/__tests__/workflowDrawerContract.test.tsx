/**
 * @jest-environment jsdom
 *
 * The rail contract, per converted surface.
 *
 * Moving the module's modals onto `Drawer` is only safe if the keyboard path
 * survives the move: `Drawer` is Radix Dialog underneath, so Escape must still
 * close, and every surface that has a primary action must still take
 * Cmd/Ctrl+Enter. A drawer that silently lost its submit shortcut looks
 * identical to one that kept it, which is exactly why this is asserted rather
 * than assumed.
 *
 * The destructive affordances are asserted here too: they OPEN a destructive
 * flow, so they render the light `destructive-outline` weight — solid red is
 * reserved for the confirmation that ends one.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AnnotationEditDialog } from '../AnnotationEditDialog'
import { AgentSelector } from '../AgentSelector'
import { WorkflowAiDraftDialog } from '../WorkflowAiDraftDialog'
import { RerunStepDialog } from '../run/RerunStepDialog'
import { ReassignTaskDialog } from '../work-inbox/ReassignTaskDialog'
import { SchemaBuilderDialog } from '../fields/SchemaBuilderDialog'
import { ANNOTATION_NOTE_NODE_TYPE } from '../../lib/editor-annotations'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.Mock

beforeEach(() => {
  apiCallMock.mockReset()
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items: [] } })
})

/** Radix renders the panel with `role="dialog"`; that node IS the rail. */
function rail(): HTMLElement {
  return screen.getByRole('dialog')
}

function pressSubmitShortcut(target: HTMLElement) {
  fireEvent.keyDown(target, { key: 'Enter', metaKey: true })
}

function pressEscape(target: HTMLElement) {
  fireEvent.keyDown(target, { key: 'Escape' })
}

const NOTE_NODE = {
  id: 'note-1',
  type: ANNOTATION_NOTE_NODE_TYPE,
  position: { x: 0, y: 0 },
  data: { markdown: 'why this branch exists' },
}

describe('annotation rail', () => {
  function renderRail(overrides: Partial<React.ComponentProps<typeof AnnotationEditDialog>> = {}) {
    const onSave = jest.fn()
    const onDelete = jest.fn()
    const onClose = jest.fn()
    renderWithProviders(
      <AnnotationEditDialog
        node={NOTE_NODE as never}
        isOpen
        onClose={onClose}
        onSave={onSave}
        onDelete={onDelete}
        {...overrides}
      />,
    )
    return { onSave, onDelete, onClose }
  }

  it('opens as a drawer rather than a centred modal', () => {
    renderRail()
    expect(screen.getByTestId('workflow-annotation-drawer')).toBeInTheDocument()
    expect(rail().getAttribute('data-slot')).toBe('drawer-content')
  })

  it('submits on Cmd/Ctrl+Enter', () => {
    const { onSave } = renderRail()
    pressSubmitShortcut(rail())
    expect(onSave).toHaveBeenCalledWith('note-1', { markdown: 'why this branch exists' })
  })

  it('closes on Escape', async () => {
    const { onClose } = renderRail()
    pressEscape(rail())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('renders its delete affordance outlined, not filled', () => {
    renderRail()
    const remove = screen.getByRole('button', { name: /delete/i })
    expect(remove.className).toContain('border-destructive')
    expect(remove.className).not.toContain('bg-destructive ')
  })
})

describe('rerun-from-step rail', () => {
  function renderRail() {
    const onConfirm = jest.fn()
    const onOpenChange = jest.fn()
    renderWithProviders(
      <RerunStepDialog
        open
        onOpenChange={onOpenChange}
        stepId="charge"
        stepLabel="Charge card"
        onConfirm={onConfirm}
      />,
    )
    return { onConfirm, onOpenChange }
  }

  it('opens as a drawer', () => {
    renderRail()
    expect(screen.getByTestId('workflow-rerun-step-drawer')).toBeInTheDocument()
  })

  it('submits on Cmd/Ctrl+Enter', () => {
    const { onConfirm } = renderRail()
    pressSubmitShortcut(rail())
    expect(onConfirm).toHaveBeenCalledWith(undefined)
  })

  it('closes on Escape', async () => {
    const { onOpenChange } = renderRail()
    pressEscape(rail())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})

describe('task reassign rail', () => {
  function renderRail() {
    const onSubmit = jest.fn()
    const onOpenChange = jest.fn()
    renderWithProviders(
      <ReassignTaskDialog open submitting={false} onOpenChange={onOpenChange} onSubmit={onSubmit} />,
    )
    return { onSubmit, onOpenChange }
  }

  it('opens as a drawer', () => {
    renderRail()
    expect(screen.getByTestId('task-reassign-dialog').getAttribute('data-slot')).toBe('drawer-content')
  })

  it('submits on Cmd/Ctrl+Enter', () => {
    const { onSubmit } = renderRail()
    fireEvent.change(screen.getByTestId('task-reassign-assignee'), { target: { value: 'user-7' } })
    pressSubmitShortcut(rail())
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ assignedTo: 'user-7', assignedToRoles: null }),
    )
  })

  it('closes on Escape', async () => {
    const { onOpenChange } = renderRail()
    pressEscape(rail())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})

describe('port schema rail', () => {
  function renderRail() {
    const onSave = jest.fn()
    const onClose = jest.fn()
    renderWithProviders(
      <SchemaBuilderDialog open value={{ inputs: [], outputs: [] }} onSave={onSave} onClose={onClose} />,
    )
    return { onSave, onClose }
  }

  it('opens as a drawer', () => {
    renderRail()
    expect(screen.getByTestId('workflow-schema-builder-drawer')).toBeInTheDocument()
  })

  it('submits on Cmd/Ctrl+Enter', () => {
    const { onSave } = renderRail()
    pressSubmitShortcut(rail())
    expect(onSave).toHaveBeenCalledWith({ inputs: [], outputs: [] })
  })

  it('closes on Escape', async () => {
    const { onClose } = renderRail()
    pressEscape(rail())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

describe('AI draft rail', () => {
  function renderRail() {
    const onApply = jest.fn(() => null)
    const onOpenChange = jest.fn()
    renderWithProviders(
      <WorkflowAiDraftDialog
        open
        onOpenChange={onOpenChange}
        onApply={onApply}
        canvasHasContent={false}
      />,
    )
    return { onApply, onOpenChange }
  }

  it('opens as a drawer, so the canvas it drafts onto stays visible', () => {
    renderRail()
    expect(screen.getByTestId('workflow-ai-draft-drawer').getAttribute('data-slot')).toBe('drawer-content')
  })

  it('generates on Cmd/Ctrl+Enter while no draft is ready', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true, definition: { steps: [] } } })
    renderRail()
    fireEvent.change(screen.getByTestId('workflow-ai-draft-prompt'), {
      target: { value: 'approve refunds over 500' },
    })
    pressSubmitShortcut(rail())
    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
  })

  it('closes on Escape', async () => {
    const { onOpenChange } = renderRail()
    pressEscape(rail())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})

describe('agent picker rail', () => {
  function renderRail() {
    const onClose = jest.fn()
    const onSelect = jest.fn()
    renderWithProviders(<AgentSelector isOpen onClose={onClose} onSelect={onSelect} />)
    return { onClose, onSelect }
  }

  it('opens as a drawer rather than a modal — the rows carry badges and prose a popover cannot hold', async () => {
    renderRail()
    await waitFor(() =>
      expect(screen.getByTestId('workflow-agent-selector-drawer').getAttribute('data-slot')).toBe(
        'drawer-content',
      ),
    )
  })

  it('closes on Escape', async () => {
    const { onClose } = renderRail()
    pressEscape(rail())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
