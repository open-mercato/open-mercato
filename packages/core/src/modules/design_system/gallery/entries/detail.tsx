import { useT } from '@open-mercato/shared/lib/i18n/context'
import * as React from 'react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  AddressesSection,
  AttachmentsSection,
  DetailFieldsSection,
  ErrorMessage,
  LoadingMessage,
  NotesSection,
  type AddressDataAdapter,
  type DetailFieldConfig,
  type NotesSectionProps,
} from '@open-mercato/ui/backend/detail'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

// Data-backed sections (Notes/Addresses) take adapter objects — the demos pass
// inline in-memory adapters, so previews never touch an API. AttachmentsSection
// fetches through `apiCall` internally and cannot take an adapter; it is shown
// in its `recordId={null}` state, where fetching is disabled by design.
function LoadingMessageEntryDefaultPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-md">
      <LoadingMessage label={t('design_system.gallery.samples.content.loadingCustomer')} />
    </div>
  )
}
function ErrorMessageEntryBasicPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-md">
      <ErrorMessage label={t('design_system.gallery.samples.content.failedToLoadCustomer')} />
    </div>
  )
}
function ErrorMessageEntryWithDescriptionActionPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-md">
      <ErrorMessage
        label={t('design_system.gallery.samples.content.failedToLoadAttachments')}
        description={t('design_system.gallery.samples.content.theStorageServiceDidNotRespondInTime')}
        action={
          <Button variant="outline" size="sm">
            {t('design_system.gallery.samples.content.retry')}
          </Button>
        }
      />
    </div>
  )
}
function NotesSectionEntryMockAdapterPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-2xl">
      <NotesSection
        entityId="person-1"
        viewerUserId="user-1"
        viewerName="Anna Nowak"
        emptyLabel={t('design_system.gallery.samples.content.noNotesYet')}
        addActionLabel={t('design_system.gallery.samples.content.addNote')}
        emptyState={{
          title: t('design_system.gallery.samples.content.noNotesYet'),
          actionLabel: t('design_system.gallery.samples.content.addNote'),
          description: t('design_system.gallery.samples.content.notesAddedHereAreVisibleToTheWholeTeam'),
        }}
        translator={t}
        dataAdapter={notesAdapter(t)}
      />
    </div>
  )
}
function AddressesSectionEntryMockAdapterPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-2xl">
      <AddressesSection
        entityId="person-1"
        emptyLabel={t('design_system.gallery.samples.content.noAddressesYet')}
        addActionLabel={t('design_system.gallery.samples.content.addAddress')}
        emptyState={{
          title: t('design_system.gallery.samples.content.noAddressesYet'),
          actionLabel: t('design_system.gallery.samples.content.addAddress'),
        }}
        translator={t}
        dataAdapter={addressesAdapter(t)}
      />
    </div>
  )
}
function AttachmentsSectionEntryUnsavedRecordPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-2xl">
      <AttachmentsSection
        entityId="customers:person"
        recordId={null}
        title={t('design_system.gallery.samples.content.attachments')}
        description={t('design_system.gallery.samples.content.filesLinkedToThisRecord')}
      />
    </div>
  )
}
function DetailFieldsSectionEntryFieldGridPreview() {
  const t = useT()
  return (
    <div className="w-full">
      <DetailFieldsSection fields={fieldGrid(t)} />
    </div>
  )
}
function DetailFieldsSectionEntryCustomFieldPreview() {
  const t = useT()
  return (
    <div className="w-full">
      <DetailFieldsSection fields={fieldGridWithCustom(t)} />
    </div>
  )
}
const saveNoop = async () => {}
const fieldGrid = (t: ReturnType<typeof useT>): DetailFieldConfig[] => [
  {
    key: 'first-name',
    kind: 'text',
    label: t('design_system.gallery.samples.content.firstName'),
    value: 'Anna',
    emptyLabel: t('design_system.gallery.samples.content.addFirstName'),
    onSave: saveNoop,
  },
  {
    key: 'phone',
    kind: 'text',
    label: t('design_system.gallery.samples.content.phone'),
    value: null,
    emptyLabel: t('design_system.gallery.samples.content.addPhone'),
    onSave: saveNoop,
  },
  {
    key: 'status',
    kind: 'select',
    label: t('design_system.gallery.samples.content.status'),
    value: 'active',
    emptyLabel: t('design_system.gallery.samples.content.setStatus'),
    options: [
      {
        value: 'active',
        label: t('design_system.gallery.samples.content.active'),
      },
      {
        value: 'inactive',
        label: t('design_system.gallery.samples.content.inactive'),
      },
    ],
    onSave: saveNoop,
  },
  {
    key: 'notes',
    kind: 'multiline',
    label: t('design_system.gallery.samples.content.notes'),
    value: t('design_system.gallery.samples.content.prefersEmailContact'),
    emptyLabel: t('design_system.gallery.samples.content.addNotes'),
    onSave: saveNoop,
    gridClassName: 'sm:col-span-2 md:col-span-3',
  },
]
const fieldGridWithCustom = (t: ReturnType<typeof useT>): DetailFieldConfig[] => [
  {
    key: 'email',
    kind: 'text',
    label: t('design_system.gallery.samples.content.email'),
    value: 'anna@example.com',
    emptyLabel: t('design_system.gallery.samples.content.addEmail'),
    onSave: saveNoop,
  },
  {
    key: 'owner',
    kind: 'custom',
    label: t('design_system.gallery.samples.content.owner'),
    emptyLabel: t('design_system.gallery.samples.content.unassigned'),
    render: () => (
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">{t('design_system.gallery.samples.content.owner')}</div>
        <Badge variant="muted">{t('design_system.gallery.samples.content.unassigned')}</Badge>
      </div>
    ),
  },
]


const notesAdapter = (t: ReturnType<typeof useT>): NotesSectionProps['dataAdapter'] => ({
  list: async () => [
    {
      id: 'note-1',
      body: t('design_system.gallery.samples.content.askedForARevisedQuoteFollowUpOnFriday'),
      createdAt: '2026-07-15T09:30:00.000Z',
      authorName: 'Anna Nowak',
    },
    {
      id: 'note-2',
      body: t('design_system.gallery.samples.content.prefersEmailContactOverPhone'),
      createdAt: '2026-07-10T14:05:00.000Z',
      authorName: 'Jan Kowalski',
    },
  ],
  create: async () => {},
  update: async () => {},
  delete: async () => {},
})
const addressesAdapter = (t: ReturnType<typeof useT>): AddressDataAdapter => ({
  list: async () => [
    {
      id: 'address-1',
      name: t('design_system.gallery.samples.content.headquarters'),
      addressLine1: 'Prosta 51',
      city: 'Warszawa',
      postalCode: '00-838',
      country: 'PL',
      isPrimary: true,
    },
    {
      id: 'address-2',
      name: t('design_system.gallery.samples.content.warehouse'),
      addressLine1: 'Magazynowa 7',
      city: 'Pruszków',
      postalCode: '05-800',
      country: 'PL',
    },
  ],
  create: async () => {},
  update: async () => {},
  delete: async () => {},
})
const detailFieldsSectionEntry: GalleryEntry = {
  id: 'detail-fields-section',
  title: 'DetailFieldsSection',
  importPath: '@open-mercato/ui/backend/detail',
  variants: [
    {
      id: 'field-grid',
      title: 'Inline-editable field grid',
      render: () => <DetailFieldsSectionEntryFieldGridPreview />,
      code: `import { DetailFieldsSection, type DetailFieldConfig } from '@open-mercato/ui/backend/detail'

const fields: DetailFieldConfig[] = [
  { key: 'first-name', kind: 'text', label: 'First name', value: person.firstName, emptyLabel: 'Add first name', onSave: saveFirstName },
  { key: 'phone', kind: 'text', label: 'Phone', value: person.phone, emptyLabel: 'Add phone', onSave: savePhone },
  {
    key: 'status', kind: 'select', label: 'Status', value: person.status, emptyLabel: 'Set status',
    options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }],
    onSave: saveStatus,
  },
  {
    key: 'notes', kind: 'multiline', label: 'Notes', value: person.notes, emptyLabel: 'Add notes',
    onSave: saveNotes, gridClassName: 'sm:col-span-2 md:col-span-3',
  },
]

<DetailFieldsSection fields={fields} />`,
    },
    {
      id: 'custom-field',
      title: 'With a custom field cell',
      render: () => <DetailFieldsSectionEntryCustomFieldPreview />,
      code: `import { DetailFieldsSection, type DetailFieldConfig } from '@open-mercato/ui/backend/detail'
import { Badge } from '@open-mercato/ui/primitives/badge'

const fields: DetailFieldConfig[] = [
  { key: 'email', kind: 'text', label: 'Email', value: person.email, emptyLabel: 'Add email', onSave: saveEmail },
  {
    key: 'owner', kind: 'custom', label: 'Owner', emptyLabel: 'Unassigned',
    render: () => (
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Owner</div>
        <Badge variant="muted">Unassigned</Badge>
      </div>
    ),
  },
]

<DetailFieldsSection fields={fields} />`,
    },
  ],
}
const loadingMessageEntry: GalleryEntry = {
  id: 'loading-message',
  title: 'LoadingMessage',
  importPath: '@open-mercato/ui/backend/detail',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => <LoadingMessageEntryDefaultPreview />,
      code: `import { LoadingMessage } from '@open-mercato/ui/backend/detail'

if (isLoading) return <LoadingMessage label={t('customers.people.detail.loading')} />`,
    },
  ],
}
const errorMessageEntry: GalleryEntry = {
  id: 'error-message',
  title: 'ErrorMessage',
  importPath: '@open-mercato/ui/backend/detail',
  variants: [
    {
      id: 'basic',
      title: 'Label only',
      render: () => <ErrorMessageEntryBasicPreview />,
      code: `import { ErrorMessage } from '@open-mercato/ui/backend/detail'

if (error) return <ErrorMessage label={error} />`,
    },
    {
      id: 'with-description-action',
      title: 'With description and action',
      render: () => <ErrorMessageEntryWithDescriptionActionPreview />,
      code: `import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'

<ErrorMessage
  label="Failed to load attachments."
  description="The storage service did not respond in time."
  action={<Button variant="outline" size="sm" onClick={retry}>Retry</Button>}
/>`,
    },
  ],
}
const notesSectionEntry: GalleryEntry = {
  id: 'notes-section',
  title: 'NotesSection',
  importPath: '@open-mercato/ui/backend/detail',
  variants: [
    {
      id: 'mock-adapter',
      title: 'Timeline (inline mock adapter — no API)',
      render: () => <NotesSectionEntryMockAdapterPreview />,
      code: `import { NotesSection, type NotesDataAdapter } from '@open-mercato/ui/backend/detail'

// Implement the adapter against your module's API (apiCall) — never fork the section.
const notesAdapter: NotesDataAdapter = {
  list: async ({ entityId }) => fetchNotes(entityId),
  create: async ({ entityId, body }) => createNote(entityId, body),
  update: async ({ id, patch }) => updateNote(id, patch),
  delete: async ({ id }) => deleteNote(id),
}

<NotesSection
  entityId={personId}
  viewerUserId={viewer.id}
  viewerName={viewer.name}
  emptyLabel={t('design_system.gallery.samples.notes.empty')}
  addActionLabel={t('design_system.gallery.samples.notes.add')}
  emptyState={{
    title: t('design_system.gallery.samples.notes.emptyTitle'),
    actionLabel: t('design_system.gallery.samples.notes.add'),
  }}
  translator={t}
  dataAdapter={notesAdapter}
/>`,
    },
  ],
}
const addressesSectionEntry: GalleryEntry = {
  id: 'addresses-section',
  title: 'AddressesSection',
  importPath: '@open-mercato/ui/backend/detail',
  variants: [
    {
      id: 'mock-adapter',
      title: 'Address tiles (inline mock adapter — no API)',
      render: () => <AddressesSectionEntryMockAdapterPreview />,
      code: `import { AddressesSection, type AddressDataAdapter } from '@open-mercato/ui/backend/detail'

const addressesAdapter: AddressDataAdapter = {
  list: async ({ entityId }) => fetchAddresses(entityId),
  create: async ({ entityId, payload }) => createAddress(entityId, payload),
  update: async ({ id, payload }) => updateAddress(id, payload),
  delete: async ({ id }) => deleteAddress(id),
}

<AddressesSection
  entityId={personId}
  emptyLabel={t('design_system.gallery.samples.addresses.empty')}
  addActionLabel={t('customers.people.detail.addresses.add')}
  emptyState={{
    title: t('design_system.gallery.samples.addresses.emptyTitle'),
    actionLabel: t('customers.people.detail.addresses.add'),
  }}
  translator={t}
  dataAdapter={addressesAdapter}
/>`,
    },
  ],
}
const attachmentsSectionEntry: GalleryEntry = {
  id: 'attachments-section',
  title: 'AttachmentsSection',
  importPath: '@open-mercato/ui/backend/detail',
  variants: [
    {
      id: 'unsaved-record',
      title: 'Unsaved record (recordId null — API fetch disabled)',
      render: () => <AttachmentsSectionEntryUnsavedRecordPreview />,
      code: `import { AttachmentsSection } from '@open-mercato/ui/backend/detail'

// Fetches /api/attachments internally once recordId is set;
// with recordId={null} it renders the save-first placeholder.
<AttachmentsSection
  entityId="customers:person"
  recordId={person?.id ?? null}
  title={t('design_system.gallery.samples.attachments.title')}
  description={t('design_system.gallery.samples.attachments.description')}
/>`,
    },
  ],
}
export const entries: GalleryEntry[] = [
  detailFieldsSectionEntry,
  loadingMessageEntry,
  errorMessageEntry,
  notesSectionEntry,
  addressesSectionEntry,
  attachmentsSectionEntry,
]
