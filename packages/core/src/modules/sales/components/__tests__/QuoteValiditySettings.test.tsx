/** @jest-environment jsdom */
import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { QuoteValiditySettings } from '../QuoteValiditySettings'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => 0 }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({ CrudForm: () => null }))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  ...jest.requireActual<typeof import('@open-mercato/ui/backend/detail/LoadingMessage')>('@open-mercato/ui/backend/detail/LoadingMessage'),
  ...jest.requireActual<typeof import('@open-mercato/ui/backend/detail/ErrorMessage')>('@open-mercato/ui/backend/detail/ErrorMessage'),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ readApiResultOrThrow: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ updateCrud: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

afterEach(cleanup)
it('shows translated loading feedback while the scoped settings read is pending', () => {
  jest.mocked(readApiResultOrThrow).mockReturnValue(new Promise(() => {}))
  render(<QuoteValiditySettings />)
  expect(screen.getByText('Loading quote validity settings…')).toBeVisible()
  expect(readApiResultOrThrow).toHaveBeenCalledWith('/api/sales/settings/quote-validity', undefined, expect.any(Object))
})
