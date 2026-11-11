/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { DealCreateSidebar, type DealCreateSidebarProps } from '../create/DealCreateSidebar'

jest.mock('../create/DealCustomAttributes', () => ({
  DealCustomAttributes: () => <div>custom attributes</div>,
}))

const translate: DealCreateSidebarProps['tr'] = (_key, fallback, params) =>
  params ? fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? '')) : fallback

describe('DealCreateSidebar', () => {
  it('still accepts the deprecated customCount input without printing a field count', () => {
    render(
      <DealCreateSidebar
        tr={translate}
        customValues={{}}
        onCustomChange={jest.fn()}
        errors={{}}
        disabled={false}
        customCount={3}
        manageHref="/backend/custom-fields"
        onCustomLoaded={jest.fn()}
      />,
    )

    expect(screen.getByText('Custom attributes')).toBeInTheDocument()
    expect(screen.getByText('custom attributes')).toBeInTheDocument()
    expect(screen.queryByText(/3 fields/)).not.toBeInTheDocument()
  })
})
