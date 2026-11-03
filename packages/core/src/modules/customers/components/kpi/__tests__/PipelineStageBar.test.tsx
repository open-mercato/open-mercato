/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { buildStageSegments, PipelineStageBar } from '../PipelineStageBar'

const dictionary = {
  negotiation: { value: 'negotiation', label: 'Negotiations', color: '#f59e0b' },
  offering: { value: 'offering', label: 'Offering', color: '#16a34a' },
}

const formatValue = (value: number) => `${value} USD`
const formatCount = (count: number) => `${count} deals`

describe('PipelineStageBar', () => {
  it('orders stages by pipeline value, colours them on the ramp by rank and folds stage-less deals into one row', () => {
    const segments = buildStageSegments(
      [
        { stage: 'negotiation', count: 1, value: 900 },
        { stage: 'discovery_call', count: 3, value: 300 },
        { stage: null, count: 2, value: 200 },
        { stage: '', count: 1, value: 50 },
        { stage: 'offering', count: 0, value: 0 },
      ],
      dictionary,
      'Unassigned',
    )
    expect(segments.map((segment) => [segment.label, segment.count, segment.value])).toEqual([
      ['Negotiations', 1, 900],
      ['Discovery call', 3, 300],
      ['Unassigned', 3, 250],
    ])
    expect(segments[0]?.color).toBe('var(--chart-indigo)')
    expect(segments[1]?.color).toBe('var(--chart-violet)')
    expect(segments[2]?.color).toBeNull()
    expect(segments[2]?.unassigned).toBe(true)
  })

  it('renders one row per stage with the value share as bar width', () => {
    const { container } = render(
      <PipelineStageBar
        stages={[{ stage: 'a', count: 2, value: 750 }, { stage: 'b', count: 1, value: 250 }]}
        stageDictionary={{}}
        unassignedLabel="Unassigned"
        formatValue={formatValue}
        formatCount={formatCount}
      />,
    )
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('750 USD')).toBeInTheDocument()
    expect(screen.getByText('2 deals')).toBeInTheDocument()
    const bars = Array.from(container.querySelectorAll('li div span[aria-hidden].flex-1 > span')) as HTMLElement[]
    expect(bars.map((bar) => bar.style.width)).toEqual(['75%', '25%'])
  })

  it('collapses the tail into one neutral row', () => {
    const values = [800, 700, 650, 500, 400, 90, 80, 70]
    const stages = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((stage, index) => ({ stage, count: 1, value: values[index]! }))
    render(
      <PipelineStageBar
        stages={stages}
        stageDictionary={{}}
        unassignedLabel="Unassigned"
        formatValue={formatValue}
        formatCount={formatCount}
        otherLabel={(count) => `${count} other stages`}
      />,
    )
    expect(screen.getByText('D')).toBeInTheDocument()
    expect(screen.queryByText('E')).not.toBeInTheDocument()
    expect(screen.getByText('4 other stages')).toBeInTheDocument()
    expect(screen.getByText('640 USD')).toBeInTheDocument()
    expect(screen.getByText('4 deals')).toBeInTheDocument()
  })

  it('renders the original three-prop call shape with plain counts, no values and bars by count', () => {
    const { container } = render(
      <PipelineStageBar
        stages={[{ stage: 'a', count: 3, value: 100 }, { stage: 'b', count: 1, value: 900 }]}
        stageDictionary={{}}
        unassignedLabel="Unassigned"
      />,
    )
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('100')).not.toBeInTheDocument()
    expect(screen.queryByText('900')).not.toBeInTheDocument()
    const bars = Array.from(container.querySelectorAll('li div span[aria-hidden].flex-1 > span')) as HTMLElement[]
    expect(bars.map((bar) => bar.style.width)).toEqual(['25%', '75%'])
  })

  it('renders nothing without open deals', () => {
    const { container } = render(
      <PipelineStageBar stages={[{ stage: 'a', count: 0, value: 0 }]} stageDictionary={{}} unassignedLabel="Unassigned" formatValue={formatValue} formatCount={formatCount} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
