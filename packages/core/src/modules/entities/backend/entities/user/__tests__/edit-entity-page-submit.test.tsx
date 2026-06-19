/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import EditDefinitionsPage from '../[entityId]/page'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: any) => <div>{children}</div>,
  PageBody: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: any) => (
    <div data-testid="crud-form-mock">
      <div data-testid="crud-form-loading">{String(props.isLoading)}</div>
      <button data-testid="submit-button" onClick={() => { void props.onSubmit?.(props.initialValues) }}>
        {props.submitLabel}
      </button>
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/custom-fields/FieldDefinitionsEditor', () => ({
  FieldDefinitionsEditor: () => <div data-testid="field-definitions-editor" />,
}))

jest.mock('@open-mercato/core/modules/translations/components/TranslationManager', () => ({
  TranslationManager: () => null,
}))

jest.mock('@open-mercato/ui/backend/fields/registry', () => ({
  loadGeneratedFieldRegistrations: jest.fn(() => Promise.resolve()),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({
  invalidateCustomFieldDefs: jest.fn(() => Promise.resolve()),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: (message: string) => new Error(message),
  raiseCrudError: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
}))

const apiCallMock = apiCall as jest.Mock
const readApiResultOrThrowMock = readApiResultOrThrow as jest.Mock

function mockLoad(entityId: string, source: 'code' | 'custom') {
  readApiResultOrThrowMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/entities/entities')) {
      return Promise.resolve({ items: [{ entityId, label: entityId, description: '', source }] })
    }
    return Promise.resolve({ items: [], deletedKeys: [], fieldsets: [], settings: {} })
  })
  apiCallMock.mockResolvedValue({ ok: true, response: {} })
}

function calledUrls(): string[] {
  return apiCallMock.mock.calls.map((call) => call[0] as string)
}

describe('EditDefinitionsPage submit (#3115)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('skips entity registration for code-declared system entities and still saves definitions', async () => {
    const entityId = 'workflows:workflow_instance'
    mockLoad(entityId, 'code')

    render(<EditDefinitionsPage params={{ entityId }} />)
    await waitFor(() => expect(screen.getByTestId('crud-form-loading')).toHaveTextContent('false'))

    fireEvent.click(screen.getByTestId('submit-button'))

    await waitFor(() => expect(calledUrls()).toContain('/api/entities/definitions.batch'))
    expect(calledUrls()).not.toContain('/api/entities/entities')
  })

  it('still registers entity metadata for custom (user-defined) entities', async () => {
    const entityId = 'demo:thing'
    mockLoad(entityId, 'custom')

    render(<EditDefinitionsPage params={{ entityId }} />)
    await waitFor(() => expect(screen.getByTestId('crud-form-loading')).toHaveTextContent('false'))

    fireEvent.click(screen.getByTestId('submit-button'))

    await waitFor(() => expect(calledUrls()).toContain('/api/entities/definitions.batch'))
    expect(calledUrls()).toContain('/api/entities/entities')
  })
})
