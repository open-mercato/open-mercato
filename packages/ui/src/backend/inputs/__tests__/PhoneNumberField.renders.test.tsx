/** @jest-environment jsdom */

const mockTranslate = (_key: string, fallback: string) => fallback
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
  useOptionalLocale: () => undefined,
}))

const mockItemRender = jest.fn()
jest.mock('../../../primitives/select', () => {
  const actual = jest.requireActual('../../../primitives/select')
  const ReactActual = jest.requireActual('react')
  return {
    ...actual,
    SelectItem: ReactActual.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      mockItemRender()
      return ReactActual.createElement(actual.SelectItem, { ...props, ref })
    }),
  }
})

import * as React from 'react'
import { render } from '@testing-library/react'
import { PHONE_COUNTRIES, PhoneNumberField } from '../PhoneNumberField'

describe('PhoneNumberField render cost', () => {
  it('does not re-render its country options when the host form re-renders it', () => {
    const view = render(<PhoneNumberField value="+48 600 100 200" onValueChange={() => {}} />)
    expect(mockItemRender.mock.calls.length).toBeGreaterThanOrEqual(PHONE_COUNTRIES.length)
    mockItemRender.mockClear()
    view.rerender(<PhoneNumberField value="+48 600 100 200" onValueChange={() => {}} />)
    view.rerender(<PhoneNumberField value="+48 600 100 201" onValueChange={() => {}} />)
    expect(mockItemRender).not.toHaveBeenCalled()
  })
})
