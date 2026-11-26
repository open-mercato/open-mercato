/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent } from '@testing-library/react'
import { screen } from '@testing-library/react'
import { z } from 'zod'
import { ComponentOverrideProvider } from '@open-mercato/ui/backend/injection/ComponentOverrideProvider'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PersonDetailHeader } from '../PersonDetailHeader'
import { PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID } from '../DetailHeaderAvatar'

const invalidateCustomerDictionaryMock = jest.fn()
const mockSendObjectMessageDialog = jest.fn()

jest.mock('@open-mercato/ui/backend/messages', () => ({
  SendObjectMessageDialog: (props: Record<string, unknown>) => {
    mockSendObjectMessageDialog(props)
    return <button type="button">Send message</button>
  },
}))

jest.mock('../hooks/useCustomerDictionary', () => ({
  useCustomerDictionary: jest.fn(() => ({ data: null })),
  invalidateCustomerDictionary: (...args: unknown[]) => invalidateCustomerDictionaryMock(...args),
}))

jest.mock('../PersonTagsDialog', () => ({
  PersonTagsDialog: () => null,
}))

describe('PersonDetailHeader', () => {
  beforeEach(() => {
    invalidateCustomerDictionaryMock.mockReset()
    mockSendObjectMessageDialog.mockReset()
  })

  it('passes the overview and heading to a replacement contact photo', () => {
    const data = {
      person: { id: 'person-1', displayName: '' },
      profile: null, customFields: {}, tags: [], comments: [], activities: [],
      interactions: [], deals: [], todos: [], companies: [],
    }
    const propsSchema = z.object({ data: z.unknown(), displayName: z.string() })
    const replacement = jest.fn((_props: unknown) => <span role="img" aria-label="Custom contact photo" />)
    renderWithProviders(
      <ComponentOverrideProvider overrides={[{
        target: { componentId: PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID },
        priority: 0, replacement, propsSchema,
      }]}>
        <PersonDetailHeader
          data={data}
          onTagsChange={jest.fn()}
          tagsSectionControllerRef={{ current: null }}
          onSave={jest.fn()}
          onDelete={jest.fn(async () => undefined)}
          isDirty={false}
          isSaving={false}
        />
      </ComponentOverrideProvider>,
    )

    const props = propsSchema.parse(replacement.mock.calls[0][0])
    expect(props.data).toBe(data)
    expect(props.displayName).toBe('Untitled')
    expect(screen.getByRole('heading', { name: props.displayName })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Custom contact photo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument()
  })

  it('renders the object history trigger in the header action cluster', () => {
    renderWithProviders(
      <PersonDetailHeader
        data={{
          person: {
            id: 'person-1',
            displayName: 'Jane Doe',
            organizationId: 'org-1',
            status: null,
            lifecycleStage: null,
            source: null,
            temperature: null,
            renewalQuarter: null,
          },
          profile: null,
          customFields: {},
          tags: [],
          comments: [],
          activities: [],
          interactions: [],
          deals: [],
          todos: [],
          companies: [],
          viewer: null,
        }}
        onTagsChange={jest.fn()}
        tagsSectionControllerRef={{ current: null }}
        onSave={jest.fn()}
        onDelete={jest.fn(async () => undefined)}
        isDirty={false}
        isSaving={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'audit_logs.version_history.title' })).toBeInTheDocument()
  })

  it('renders the send-message trigger in the header action cluster', () => {
    renderWithProviders(
      <PersonDetailHeader
        actions={<button type="button">Extension action</button>}
        data={{
          person: {
            id: 'person-1',
            displayName: 'Jane Doe',
            organizationId: 'org-1',
            primaryEmail: 'jane@example.com',
            status: null,
            lifecycleStage: null,
            source: null,
            temperature: null,
            renewalQuarter: null,
          },
          profile: null,
          customFields: {},
          tags: [],
          comments: [],
          activities: [],
          interactions: [],
          deals: [],
          todos: [],
          companies: [],
          viewer: null,
        }}
        onTagsChange={jest.fn()}
        tagsSectionControllerRef={{ current: null }}
        onSave={jest.fn()}
        onDelete={jest.fn(async () => undefined)}
        isDirty={false}
        isSaving={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Extension action' }).parentElement).toBe(screen.getByRole('button', { name: 'Send message' }).parentElement)
    expect(mockSendObjectMessageDialog).toHaveBeenCalledWith(expect.objectContaining({
      object: expect.objectContaining({
        entityModule: 'customers',
        entityType: 'person',
        entityId: 'person-1',
      }),
      buttonVariant: 'outline',
      buttonSize: 'icon',
    }))
  })

  it('triggers deletion directly from the trash action', () => {
    const onDelete = jest.fn(async () => undefined)

    renderWithProviders(
      <PersonDetailHeader
        data={{
          person: {
            id: 'person-1',
            displayName: 'Jane Doe',
            organizationId: 'org-1',
            status: null,
            lifecycleStage: null,
            source: null,
            temperature: null,
            renewalQuarter: null,
          },
          profile: null,
          customFields: {},
          tags: [],
          comments: [],
          activities: [],
          interactions: [],
          deals: [],
          todos: [],
          companies: [],
          viewer: null,
        }}
        onTagsChange={jest.fn()}
        tagsSectionControllerRef={{ current: null }}
        onSave={jest.fn()}
        onDelete={onDelete}
        isDirty={false}
        isSaving={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('does not render a "Link company" CTA in the header (SPEC-2026-04-19 removal)', () => {
    const onOpenCompaniesTab = jest.fn()
    renderWithProviders(
      <PersonDetailHeader
        data={{
          person: {
            id: 'person-1',
            displayName: 'Jane Doe',
            organizationId: 'org-1',
            status: null,
            lifecycleStage: null,
            source: null,
            temperature: null,
            renewalQuarter: null,
          },
          profile: null,
          customFields: {},
          tags: [],
          comments: [],
          activities: [],
          interactions: [],
          deals: [],
          todos: [],
          companies: [],
          viewer: null,
        }}
        onTagsChange={jest.fn()}
        tagsSectionControllerRef={{ current: null }}
        onSave={jest.fn()}
        onDelete={jest.fn(async () => undefined)}
        isDirty={false}
        isSaving={false}
        onOpenCompaniesTab={onOpenCompaniesTab}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Link company' })).not.toBeInTheDocument()
    expect(onOpenCompaniesTab).not.toHaveBeenCalled()
  })
})
