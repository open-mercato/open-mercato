/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { useFeatureToggleItem } from '@open-mercato/core/modules/feature_toggles/components/hooks/useFeatureToggleItem'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: any) => <div>{children}</div>,
  PageBody: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: any) => <div data-testid="loading-message">{label}</div>,
  ErrorMessage: ({ label }: any) => <div data-testid="error-message">{label}</div>,
}))

let capturedInitialValues: Record<string, unknown> | null = null
let crudFormRenderCount = 0

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: any) => {
    crudFormRenderCount += 1
    capturedInitialValues = props.initialValues
    return <div data-testid="crud-form-mock" />
  },
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/feature_toggles/components/formConfig', () => ({
  createFieldDefinitions: () => [],
  createFormGroups: () => [],
}))

jest.mock('@open-mercato/core/modules/feature_toggles/components/hooks/useFeatureToggleItem', () => ({
  useFeatureToggleItem: jest.fn(),
}))

import EditFeatureTogglePage from '../page'

const mockHook = useFeatureToggleItem as jest.Mock

describe('EditFeatureTogglePage — Type/Default Value hydration (#2524)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedInitialValues = null
    crudFormRenderCount = 0
  })

  it('does not mount CrudForm with placeholder values while the record is still loading', () => {
    mockHook.mockReturnValue({ data: undefined, isLoading: true, isError: false })

    render(<EditFeatureTogglePage params={{ id: 'toggle-1' }} />)

    // The required `type` Select must not mount controlled with '' before the
    // record arrives — that empty→value flip is what blanked Type and blocked
    // save. While loading we show LoadingMessage instead of the form.
    expect(screen.queryByTestId('crud-form-mock')).toBeNull()
    expect(screen.getByTestId('loading-message')).toBeInTheDocument()
    expect(crudFormRenderCount).toBe(0)
  })

  it('mounts CrudForm with the stored type and defaultValue once the record loads', () => {
    mockHook.mockReturnValue({
      data: {
        identifier: 'feature_toggles_ui',
        name: 'Feature toggles UI',
        description: 'desc',
        category: 'ui',
        type: 'boolean',
        defaultValue: true,
      },
      isLoading: false,
      isError: false,
    })

    render(<EditFeatureTogglePage params={{ id: 'toggle-1' }} />)

    expect(screen.getByTestId('crud-form-mock')).toBeInTheDocument()
    // The Select mounts a single time with the stored value already present.
    expect(capturedInitialValues).not.toBeNull()
    expect(capturedInitialValues!.type).toBe('boolean')
    expect(capturedInitialValues!.defaultValue).toBe(true)
  })

  it('shows an error state instead of the form when loading fails', () => {
    mockHook.mockReturnValue({ data: undefined, isLoading: false, isError: true })

    render(<EditFeatureTogglePage params={{ id: 'toggle-1' }} />)

    expect(screen.queryByTestId('crud-form-mock')).toBeNull()
    expect(screen.getByTestId('error-message')).toBeInTheDocument()
  })
})
