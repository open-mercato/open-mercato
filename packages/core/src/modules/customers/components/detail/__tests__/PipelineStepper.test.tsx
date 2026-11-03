/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PipelineStepper } from '../PipelineStepper'

describe('PipelineStepper', () => {
  const formatTransitionDate = (value: string) =>
    new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  it('labels every stage, keeps dates off the strip and shows the current stage date in the compact view', () => {
    const qualificationDate = formatTransitionDate('2026-03-12T09:00:00.000Z')
    const proposalDate = formatTransitionDate('2026-03-20T09:00:00.000Z')
    const currentDate = formatTransitionDate('2026-04-01T09:00:00.000Z')

    renderWithProviders(
      <PipelineStepper
        stages={[
          { id: 'stage-1', label: 'Qualification', order: 1 },
          { id: 'stage-2', label: 'Proposal', order: 2 },
          { id: 'stage-3', label: 'Negotiation', order: 3 },
          { id: 'stage-4', label: 'Contract', order: 4 },
        ]}
        transitions={[
          {
            stageId: 'stage-1',
            stageLabel: 'Qualification',
            stageOrder: 1,
            transitionedAt: '2026-03-12T09:00:00.000Z',
          },
          {
            stageId: 'stage-2',
            stageLabel: 'Proposal',
            stageOrder: 2,
            transitionedAt: '2026-03-20T09:00:00.000Z',
          },
          {
            stageId: 'stage-3',
            stageLabel: 'Negotiation',
            stageOrder: 3,
            transitionedAt: '2026-04-01T09:00:00.000Z',
          },
        ]}
        currentStageId="stage-3"
        pipelineName="Enterprise Sales pipeline"
      />,
    )

    expect(screen.getAllByText('Qualification').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Proposal').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Negotiation').length).toBeGreaterThan(0)
    expect(screen.queryByText(qualificationDate)).not.toBeInTheDocument()
    expect(screen.queryByText(proposalDate)).not.toBeInTheDocument()
    expect(screen.getAllByText(`${currentDate}, current`).length).toBeGreaterThan(0)
    expect(screen.getByText('Contract')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('exposes progressbar semantics and marks the current stage with aria-current', () => {
    const { container } = renderWithProviders(
      <PipelineStepper
        stages={[
          { id: 'stage-1', label: 'Qualification', order: 1 },
          { id: 'stage-2', label: 'Proposal', order: 2 },
          { id: 'stage-3', label: 'Negotiation', order: 3 },
          { id: 'stage-4', label: 'Contract', order: 4 },
        ]}
        transitions={[
          { stageId: 'stage-1', stageLabel: 'Qualification', stageOrder: 1, transitionedAt: '2026-03-12T09:00:00.000Z' },
          { stageId: 'stage-2', stageLabel: 'Proposal', stageOrder: 2, transitionedAt: '2026-03-20T09:00:00.000Z' },
        ]}
        currentStageId="stage-2"
        pipelineName="Enterprise Sales"
      />,
    )

    const progressbar = screen.getByRole('progressbar')
    expect(progressbar).toHaveAttribute('aria-valuemin', '0')
    expect(progressbar).toHaveAttribute('aria-valuemax', '4')
    expect(progressbar).toHaveAttribute('aria-valuenow', '2')
    expect(progressbar).toHaveAttribute('aria-valuetext', expect.stringContaining('Proposal'))
    expect(progressbar.getAttribute('aria-label')).toContain('Enterprise Sales')

    const currentSteps = container.querySelectorAll('[aria-current="step"]')
    expect(currentSteps.length).toBeGreaterThan(0)
  })

  it('moves the deal from the path and keeps the current stage read-only', () => {
    const onStageChange = jest.fn()
    renderWithProviders(
      <PipelineStepper
        stages={[
          { id: 'stage-1', label: 'Qualification', order: 1 },
          { id: 'stage-2', label: 'Proposal', order: 2 },
        ]}
        transitions={[]}
        currentStageId="stage-1"
        onStageChange={onStageChange}
      />,
    )
    expect(screen.queryByRole('button', { name: /Qualification/ })).not.toBeInTheDocument()
    const proposalSegment = screen.getByRole('button', { name: /Proposal/ })
    expect(proposalSegment).toHaveAttribute('data-slot', 'button')
    expect(proposalSegment).toHaveAttribute('type', 'button')
    fireEvent.click(proposalSegment)
    expect(onStageChange).toHaveBeenCalledWith('stage-2')
  })

  it('renders a read-only path while the form is dirty', () => {
    renderWithProviders(
      <PipelineStepper
        stages={[
          { id: 'stage-1', label: 'Qualification', order: 1 },
          { id: 'stage-2', label: 'Proposal', order: 2 },
        ]}
        transitions={[]}
        currentStageId="stage-1"
        onStageChange={jest.fn()}
        stageChangeDisabled
      />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the outcome as the final step once the deal is closed', () => {
    renderWithProviders(
      <PipelineStepper
        stages={[
          { id: 'stage-1', label: 'Qualification', order: 1 },
          { id: 'stage-2', label: 'Proposal', order: 2 },
        ]}
        transitions={[]}
        currentStageId="stage-2"
        closureOutcome="lost"
      />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items[items.length - 1]).toHaveTextContent('Lost')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([
    ['no stages at all', []],
    ['only terminal stages', [{ id: 'stage-won', label: 'Won', order: 1 }]],
  ])('still shows the outcome of a closed deal with %s', (_name, stages) => {
    renderWithProviders(
      <PipelineStepper stages={stages} transitions={[]} currentStageId={null} closureOutcome="won" />,
    )
    expect(screen.getByText('Won')).toBeInTheDocument()
  })

  it('renders nothing for an open deal without stages', () => {
    const { container } = renderWithProviders(
      <PipelineStepper stages={[]} transitions={[]} currentStageId={null} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('announces the closure outcome in aria-valuetext when the deal is closed', () => {
    renderWithProviders(
      <PipelineStepper
        stages={[
          { id: 'stage-1', label: 'Qualification', order: 1 },
          { id: 'stage-2', label: 'Proposal', order: 2 },
        ]}
        transitions={[]}
        currentStageId="stage-2"
        closureOutcome="won"
      />,
    )
    const progressbar = screen.getByRole('progressbar')
    expect(progressbar.getAttribute('aria-valuetext')).toMatch(/won/i)
  })
})
