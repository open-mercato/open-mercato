/**
 * @jest-environment jsdom
 */
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import EditCatalogCategoryPage from '../[id]/edit/page'

type MockCrudFormProps = {
  initialValues: Record<string, unknown>
  isLoading?: boolean
  onSubmit: (values: Record<string, unknown>) => Promise<void>
}

const mockTranslate = (key: string, fallback?: string) => fallback ?? key
let mockDescription: unknown = ''

jest.mock('#generated/entities.ids.generated', () => ({
  E: { catalog: { catalog_product_category: 'catalog:catalog_product_category' } },
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/catalog/categories/category-1/edit',
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ initialValues, isLoading, onSubmit }: MockCrudFormProps) =>
    isLoading ? null : (
      <button onClick={() => void onSubmit({ ...initialValues, description: mockDescription })}>Save</button>
    ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ErrorMessage: () => null,
  RecordNotFoundState: () => null,
}))

jest.mock('@open-mercato/ui/backend/injection/recordContext', () => ({
  buildRecordInjectionContext: () => ({}),
  useSetCurrentRecordInjectionContext: () => undefined,
}))

jest.mock('@open-mercato/ui/backend/messages', () => ({
  SendObjectMessageDialog: () => null,
}))

jest.mock('../../../../components/categories/CategorySelect', () => ({ CategorySelect: () => null }))
jest.mock('../../../../components/categories/CategorySlugFieldSync', () => ({ CategorySlugFieldSync: () => null }))

async function submitWithDescription(description: unknown): Promise<Record<string, unknown>> {
  mockDescription = description
  render(<EditCatalogCategoryPage params={{ id: 'category-1' }} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
  await waitFor(() => expect(updateCrud).toHaveBeenCalledTimes(1))
  const [resource, payload] = jest.mocked(updateCrud).mock.calls[0]
  expect(resource).toBe('catalog/categories')
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>
}

describe('EditCatalogCategoryPage description payload', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(apiCall).mockResolvedValue({
      ok: true,
      status: 200,
      result: {
        items: [
          {
            id: 'category-1',
            name: 'Shoes',
            slug: 'shoes',
            description: 'Stored description',
            parentId: null,
            isActive: true,
          },
        ],
      },
      response: {} as Response,
      cacheStatus: null,
    })
  })

  it.each([
    ['empty', ''],
    ['whitespace-only', '   \n '],
    ['null', null],
  ])('sends null when the description is %s', async (_label, description) => {
    const payload = await submitWithDescription(description)
    expect(payload).toHaveProperty('description', null)
  })

  it.each([
    ['missing', undefined],
    ['a non-string value', { text: 'New description' }],
  ])('omits the description when it is %s', async (_label, description) => {
    const payload = await submitWithDescription(description)
    expect(payload).not.toHaveProperty('description')
  })

  it('sends the trimmed text for a filled description', async () => {
    const payload = await submitWithDescription('  New description  ')
    expect(payload.description).toBe('New description')
  })
})
