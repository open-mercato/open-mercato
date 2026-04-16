/** @jest-environment jsdom */

import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PipelineStepper } from '../PipelineStepper'

describe('PipelineStepper', () => {
  it('renders achieved stage dates and marks the current stage like the detail mockup', () => {
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
    expect(screen.getByText(/Mar 12|12 Mar/)).toBeInTheDocument()
    expect(screen.getByText(/Mar 20|20 Mar/)).toBeInTheDocument()
    expect(screen.getAllByText(/Apr 1.*current|1 Apr.*current/i).length).toBeGreaterThan(0)
    expect(screen.getByText('Contract')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
