/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

type SubmitHandler = (values: Record<string, unknown>) => Promise<void>
let capturedOnSubmit: SubmitHandler | null = null
let capturedInitialValues: Record<string, unknown> | null = null

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: { onSubmit: SubmitHandler; initialValues: Record<string, unknown> }) => {
    capturedOnSubmit = props.onSubmit
    capturedInitialValues = props.initialValues
    return <div data-testid="crud-form-mock" />
  },
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn().mockResolvedValue({ result: { id: 'toggle-1' } }),
}))

jest.mock('@open-mercato/core/modules/feature_toggles/components/formConfig', () => ({
  createFieldDefinitions: () => [],
  createFormGroups: () => [],
}))

import CreateFeatureTogglePage from '../page'

describe('CreateFeatureTogglePage — default value persistence (#8859)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedOnSubmit = null
    capturedInitialValues = null
  })

  it('persists an untouched boolean default as the explicit false the form displays', async () => {
    render(<CreateFeatureTogglePage />)
    expect(capturedInitialValues?.defaultValue).toBeNull()

    await capturedOnSubmit!({
      ...capturedInitialValues,
      identifier: 'beta_banner',
      name: 'Beta banner',
      type: 'boolean',
    })

    expect(createCrud).toHaveBeenCalledWith(
      'feature_toggles/global',
      expect.objectContaining({ type: 'boolean', defaultValue: false }),
    )
  })
})
