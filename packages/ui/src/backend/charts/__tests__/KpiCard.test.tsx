/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { KpiCard } from '../KpiCard'

describe('KpiCard', () => {
  it('keeps the footer when there is no value, because the footer is what explains the dash', () => {
    render(<KpiCard title="Latest NPS" value={null} footer={<span>Never answered a survey</span>} />)
    expect(screen.getByText('--')).toBeTruthy()
    expect(screen.getByText('Never answered a survey')).toBeTruthy()
  })

  it('renders the footer beside a value as before', () => {
    render(<KpiCard title="Orders" value={3} footer={<span>last 30 days</span>} />)
    expect(screen.getByText('last 30 days')).toBeTruthy()
  })
})
