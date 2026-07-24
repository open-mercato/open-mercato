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

const saveNoop = async () => {}

const fieldGrid: DetailFieldConfig[] = [
  {
    key: 'first-name',
    kind: 'text',
    label: 'First name',
    value: 'Anna',
    emptyLabel: 'Add first name',
    onSave: saveNoop,
  },
  {
    key: 'phone',
    kind: 'text',
    label: 'Phone',
    value: null,
    emptyLabel: 'Add phone',
    onSave: saveNoop,
  },
  {
    key: 'status',
    kind: 'select',
    label: 'Status',
    value: 'active',
    emptyLabel: 'Set status',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
    ],
    onSave: saveNoop,
  },
  {
    key: 'notes',
    kind: 'multiline',
    label: 'Notes',
    value: 'Prefers email contact.',
    emptyLabel: 'Add notes',
    onSave: saveNoop,
    gridClassName: 'sm:col-span-2 md:col-span-3',
  },
]

const fieldGridWithCustom: DetailFieldConfig[] = [
  {
    key: 'email',
    kind: 'text',
    label: 'Email',
    value: 'anna@example.com',
    emptyLabel: 'Add email',
    onSave: saveNoop,
  },
  {
    key: 'owner',
    kind: 'custom',
    label: 'Owner',
    emptyLabel: 'Unassigned',
    render: () => (
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Owner</div>
        <Badge variant="muted">Unassigned</Badge>
      </div>
    ),
  },
]

// Sections resolve their labels through an app translator in real pages; the
// gallery translator just surfaces each key's fallback (or last segment).
const galleryTranslator = (key: string, fallback?: string) =>
  fallback ?? key.split('.').pop() ?? key

const notesAdapter: NotesSectionProps['dataAdapter'] = {
  list: async () => [
    {
      id: 'note-1',
      body: 'Asked for a revised quote — follow up on Friday.',
      createdAt: '2026-07-15T09:30:00.000Z',
      authorName: 'Anna Nowak',
    },
    {
      id: 'note-2',
      body: 'Prefers email contact over phone.',
      createdAt: '2026-07-10T14:05:00.000Z',
      authorName: 'Jan Kowalski',
    },
  ],
  create: async () => {},
  update: async () => {},
  delete: async () => {},
}

const addressesAdapter: AddressDataAdapter = {
  list: async () => [
    {
      id: 'address-1',
      name: 'Headquarters',
      addressLine1: 'Prosta 51',
      city: 'Warszawa',
      postalCode: '00-838',
      country: 'PL',
      isPrimary: true,
    },
    {
      id: 'address-2',
      name: 'Warehouse',
      addressLine1: 'Magazynowa 7',
      city: 'Pruszków',
      postalCode: '05-800',
      country: 'PL',
    },
  ],
  create: async () => {},
  update: async () => {},
  delete: async () => {},
}

const detailFieldsSectionEntry: GalleryEntry = {
  id: 'detail-fields-section',
  title: 'DetailFieldsSection',
  importPath: '@open-mercato/ui/backend/detail',
  variants: [
    {
      id: 'field-grid',
      title: 'Inline-editable field grid',
      render: () => (
        <div className="w-full">
          <DetailFieldsSection fields={fieldGrid} />
        </div>
      ),
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
      render: () => (
        <div className="w-full">
          <DetailFieldsSection fields={fieldGridWithCustom} />
        </div>
      ),
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
      render: () => (
        <div className="w-full max-w-md">
          <LoadingMessage label="Loading customer…" />
        </div>
      ),
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
      render: () => (
        <div className="w-full max-w-md">
          <ErrorMessage label="Failed to load customer." />
        </div>
      ),
      code: `import { ErrorMessage } from '@open-mercato/ui/backend/detail'

if (error) return <ErrorMessage label={error} />`,
    },
    {
      id: 'with-description-action',
      title: 'With description and action',
      render: () => (
        <div className="w-full max-w-md">
          <ErrorMessage
            label="Failed to load attachments."
            description="The storage service did not respond in time."
            action={
              <Button variant="outline" size="sm">
                Retry
              </Button>
            }
          />
        </div>
      ),
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
      render: () => (
        <div className="w-full max-w-2xl">
          <NotesSection
            entityId="person-1"
            viewerUserId="user-1"
            viewerName="Anna Nowak"
            emptyLabel="No notes yet"
            addActionLabel="Add note"
            emptyState={{
              title: 'No notes yet',
              actionLabel: 'Add note',
              description: 'Notes added here are visible to the whole team.',
            }}
            translator={galleryTranslator}
            dataAdapter={notesAdapter}
          />
        </div>
      ),
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
  emptyLabel={t('customers.people.detail.notes.empty')}
  addActionLabel={t('customers.people.detail.notes.add')}
  emptyState={{
    title: t('customers.people.detail.notes.emptyTitle'),
    actionLabel: t('customers.people.detail.notes.add'),
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
      render: () => (
        <div className="w-full max-w-2xl">
          <AddressesSection
            entityId="person-1"
            emptyLabel="No addresses yet"
            addActionLabel="Add address"
            emptyState={{ title: 'No addresses yet', actionLabel: 'Add address' }}
            translator={galleryTranslator}
            dataAdapter={addressesAdapter}
          />
        </div>
      ),
      code: `import { AddressesSection, type AddressDataAdapter } from '@open-mercato/ui/backend/detail'

const addressesAdapter: AddressDataAdapter = {
  list: async ({ entityId }) => fetchAddresses(entityId),
  create: async ({ entityId, payload }) => createAddress(entityId, payload),
  update: async ({ id, payload }) => updateAddress(id, payload),
  delete: async ({ id }) => deleteAddress(id),
}

<AddressesSection
  entityId={personId}
  emptyLabel={t('customers.people.detail.addresses.empty')}
  addActionLabel={t('customers.people.detail.addresses.add')}
  emptyState={{
    title: t('customers.people.detail.addresses.emptyTitle'),
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
      render: () => (
        <div className="w-full max-w-2xl">
          <AttachmentsSection
            entityId="customers:person"
            recordId={null}
            title="Attachments"
            description="Files linked to this record."
          />
        </div>
      ),
      code: `import { AttachmentsSection } from '@open-mercato/ui/backend/detail'

// Fetches /api/attachments internally once recordId is set;
// with recordId={null} it renders the save-first placeholder.
<AttachmentsSection
  entityId="customers:person"
  recordId={person?.id ?? null}
  title={t('customers.people.detail.attachments.title')}
  description={t('customers.people.detail.attachments.description')}
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
