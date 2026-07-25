/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import EditDefinitionsPage from '../[entityId]/page'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

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
  // Real optimistic-lock header wiring flows through this scope, so record the
  // headers each mutating call is wrapped with (issue #3152) and still run it.
  withScopedApiRequestHeaders: jest.fn((_headers: Record<string, string>, run: () => Promise<unknown>) => run()),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

const apiCallMock = apiCall as jest.Mock
const readApiResultOrThrowMock = readApiResultOrThrow as jest.Mock
const withScopedApiRequestHeadersMock = withScopedApiRequestHeaders as jest.Mock

function mockLoad(entityId: string, source: 'code' | 'custom', version?: string) {
  readApiResultOrThrowMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/entities/entities')) {
      return Promise.resolve({ items: [{ entityId, label: entityId, description: '', source }] })
    }
    return Promise.resolve({ items: [], deletedKeys: [], fieldsets: [], settings: {}, version })
  })
  apiCallMock.mockResolvedValue({ ok: true, response: {}, result: { ok: true } })
}

function calledUrls(): string[] {
  return apiCallMock.mock.calls.map((call) => call[0] as string)
}

function scopedHeaderSets(): Array<Record<string, string>> {
  return withScopedApiRequestHeadersMock.mock.calls.map((call) => call[0] as Record<string, string>)
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

  it('sends the loaded schema version as the optimistic-lock header on the definitions batch (#3152)', async () => {
    const entityId = 'workflows:workflow_instance'
    mockLoad(entityId, 'code', '2026-06-01T00:00:00.000Z')

    render(<EditDefinitionsPage params={{ entityId }} />)
    await waitFor(() => expect(screen.getByTestId('crud-form-loading')).toHaveTextContent('false'))

    fireEvent.click(screen.getByTestId('submit-button'))

    await waitFor(() => expect(calledUrls()).toContain('/api/entities/definitions.batch'))
    // The batch mutation is wrapped with the expected-version header carrying the
    // token the form loaded, so a concurrent edit is rejected server-side.
    expect(scopedHeaderSets()).toContainEqual({
      [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-06-01T00:00:00.000Z',
    })
  })
})
