/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen } from '@testing-library/react'
import { FormHeader } from '../forms/FormHeader'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockInjectionSpot = jest.fn()

jest.mock('next/link', () => {
  const React = require('react')
  return React.forwardRef(
    (
      { children, href, ...rest }: { children: React.ReactNode; href?: string },
      ref: React.ForwardedRef<HTMLAnchorElement>,
    ) => (
      <a href={typeof href === 'string' ? href : href?.toString?.()} ref={ref} {...rest}>
        {children}
      </a>
    ),
  )
})

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/customers/people/123',
  useSearchParams: () => new URLSearchParams('showIncomingChanges=1'),
}))

jest.mock('../injection/InjectionSpot', () => ({
  InjectionSpot: (props: { spotId: string; context?: Record<string, unknown> }) => {
    mockInjectionSpot(props)
    return <div data-testid={`injection-spot:${props.spotId}`} />
  },
}))

describe('FormHeader', () => {
  beforeEach(() => {
    mockInjectionSpot.mockClear()
  })

  it('renders detail header injection spot with routing context', () => {
    renderWithProviders(
      <FormHeader mode="detail" title="Person Detail" />,
      { dict: {} },
    )

    expect(screen.getByText('Person Detail')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:form-header:detail')).toBeInTheDocument()
    expect(mockInjectionSpot).toHaveBeenCalledWith(
      expect.objectContaining({
        spotId: 'form-header:detail',
        context: {
          path: '/backend/customers/people/123',
          query: 'showIncomingChanges=1',
        },
      }),
    )
  })

  it('renders edit header injection spot with routing context', () => {
    renderWithProviders(
      <FormHeader title="Edit Person" />,
      { dict: {} },
    )

    expect(screen.getByText('Edit Person')).toBeInTheDocument()
    expect(screen.getByTestId('injection-spot:form-header:edit')).toBeInTheDocument()
    expect(mockInjectionSpot).toHaveBeenCalledWith(
      expect.objectContaining({
        spotId: 'form-header:edit',
        context: {
          path: '/backend/customers/people/123',
          query: 'showIncomingChanges=1',
        },
      }),
    )
  })
})

