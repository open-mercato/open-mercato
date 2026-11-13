/**
 * @jest-environment jsdom
 *
 * Where the canvas trigger pill LANDS (fidelity gap #5).
 *
 * The pill says "here is how this workflow starts", so its action has to reach
 * the editor for that — not the top of a twelve-field form the author then has
 * to hunt through. The drawer's sections are therefore addressable, and opening
 * it at one focuses that section: focus rather than a bare scroll, because the
 * keyboard path has to arrive there too and a screen reader has to be told it
 * did.
 */
import * as React from 'react'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DefinitionMetadataDrawer } from '../DefinitionMetadataDrawer'
import type { WorkflowMetadataHandlers, WorkflowMetadataState } from '../../data/types'

// The sub-editors are exercised by their own suites and pull an events API in;
// this file is about which section the drawer lands on.
jest.mock('../ContextSchemaEditor', () => ({ ContextSchemaEditor: () => <div data-testid="context-schema" /> }))
jest.mock('../DefinitionTriggersEditor', () => ({
  DefinitionTriggersEditor: () => <div data-testid="triggers-editor" />,
}))
jest.mock('../DefinitionErrorHandlerField', () => ({
  DefinitionErrorHandlerField: () => <div data-testid="error-handler" />,
}))
jest.mock('../WorkflowIconPicker', () => ({ WorkflowIconPicker: () => <div data-testid="icon-picker" /> }))

const METADATA: WorkflowMetadataState = {
  workflowId: 'checkout',
  workflowName: 'Checkout',
  description: '',
  version: 1,
  enabled: true,
  category: '',
  tags: [],
  icon: '',
  effectiveFrom: '',
  effectiveTo: '',
  triggers: [],
}

const HANDLERS: WorkflowMetadataHandlers = {
  setWorkflowId: jest.fn(),
  setWorkflowName: jest.fn(),
  setDescription: jest.fn(),
  setVersion: jest.fn(),
  setEnabled: jest.fn(),
  setCategory: jest.fn(),
  setTags: jest.fn(),
  setIcon: jest.fn(),
  setEffectiveFrom: jest.fn(),
  setEffectiveTo: jest.fn(),
  setTriggers: jest.fn(),
  setContextSchema: jest.fn(),
  setInterpolation: jest.fn(),
  setErrorHandler: jest.fn(),
}

function renderDrawer(focusSection: 'inputs' | 'runtime' | null) {
  return renderWithProviders(
    <DefinitionMetadataDrawer
      open
      onOpenChange={jest.fn()}
      focusSection={focusSection}
      definitionId="11111111-1111-4111-8111-111111111111"
      metadata={METADATA}
      handlers={HANDLERS}
      errorHandlerStepOptions={[]}
    />,
  )
}

async function flushFrame() {
  await act(async () => {
    jest.advanceTimersByTime(32)
  })
}

describe('the drawer opens at the section it was asked for', () => {
  beforeAll(() => {
    // jsdom implements neither, and the drawer waits a frame before scrolling.
    Element.prototype.scrollIntoView = jest.fn()
    jest.useFakeTimers()
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  it('focuses "Inputs", which is where the context inputs live', async () => {
    renderDrawer('inputs')
    await flushFrame()

    const section = document.querySelector('[data-metadata-section="inputs"]')
    expect(section).not.toBeNull()
    expect(document.activeElement).toBe(section)
    expect(section?.scrollIntoView).toBeDefined()
    // Triggers moved to the START-node cap's own modal (Direction A); the inputs
    // section now hosts the context-schema editor, which took focus.
    expect(section?.contains(screen.getByTestId('context-schema'))).toBe(true)
  })

  it('leaves focus alone when no section is requested — every other way in wants the top', async () => {
    renderDrawer(null)
    await flushFrame()

    const sections = Array.from(document.querySelectorAll('[data-metadata-section]'))
    expect(sections).toHaveLength(5)
    // Not "not the inputs section" — NO section may steal focus, or the drawer
    // would jump somewhere arbitrary every time the toolbar opens it.
    expect(sections).not.toContain(document.activeElement)
  })

  it('addresses every section, so the affordance is not a one-off special case', async () => {
    renderDrawer('runtime')
    await flushFrame()

    const ids = Array.from(document.querySelectorAll('[data-metadata-section]')).map((node) =>
      node.getAttribute('data-metadata-section'),
    )
    expect(ids).toEqual(['identity', 'presentation', 'availability', 'inputs', 'runtime'])
    expect(document.activeElement).toBe(document.querySelector('[data-metadata-section="runtime"]'))
  })
})
