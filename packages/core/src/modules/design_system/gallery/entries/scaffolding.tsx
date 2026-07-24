import * as React from 'react'
import { Archive, Copy, Download, Lock, Plus, Trash2, UserRound } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { CollapsibleSection, SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import {
  SectionNav,
  SectionPage,
  type SectionNavGroup,
} from '@open-mercato/ui/backend/section-page'
import {
  ActionsDropdown,
  FormFooter,
  FormHeader,
  type ActionItem,
} from '@open-mercato/ui/backend/forms'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

// The demos use `#`-anchors as hrefs so clicking inside the gallery never
// navigates away, and every callback is a no-op.

const demoSections: SectionNavGroup[] = [
  {
    id: 'account',
    label: 'Account',
    items: [
      { id: 'profile', label: 'Profile', href: '#profile', icon: <UserRound className="size-4" /> },
      { id: 'security', label: 'Security', href: '#security', icon: <Lock className="size-4" /> },
    ],
  },
]

// SectionPage stretches to the viewport by design — the miniature demo clips
// it inside a fixed-height frame so the two-item nav plus content stay small.
function SectionPageMiniDemo() {
  return (
    <div className="h-80 w-full overflow-hidden rounded-lg border bg-background">
      <SectionPage title="Settings" sections={demoSections} activePath="#profile">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Profile</h2>
          <p className="text-sm text-muted-foreground">Section content renders here.</p>
        </div>
      </SectionPage>
    </div>
  )
}

// SectionNav is controlled — the demo owns the collapsed state.
function SectionNavDemo() {
  const [collapsed, setCollapsed] = React.useState(false)
  return (
    <div className="w-64 rounded-lg border bg-background px-3 py-4">
      <SectionNav
        title="Settings"
        sections={demoSections}
        activePath="#profile"
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((value) => !value)}
      />
    </div>
  )
}

const demoActions: ActionItem[] = [
  { id: 'duplicate', label: 'Duplicate record', icon: Copy, onSelect: () => {} },
  { id: 'export', label: 'Export as CSV', icon: Download, onSelect: () => {} },
  { id: 'delete', label: 'Delete record', icon: Trash2, onSelect: () => {} },
]

const pageEntry: GalleryEntry = {
  id: 'page',
  title: 'Page',
  importPath: '@open-mercato/ui/backend/Page',
  variants: [
    {
      id: 'basic',
      title: 'Page + PageHeader + PageBody',
      render: () => (
        <div className="w-full">
          <Page>
            <PageHeader title="Currencies" description="Exchange rates refresh nightly." />
            <PageBody>
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Page content
              </div>
            </PageBody>
          </Page>
        </div>
      ),
      code: `import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'

<Page>
  <PageHeader title={t('currencies.list.title')} description={t('currencies.list.description')} />
  <PageBody>{/* DataTable, sections… */}</PageBody>
</Page>`,
    },
    {
      id: 'with-actions',
      title: 'Header actions',
      render: () => (
        <div className="w-full">
          <Page>
            <PageHeader
              title="Currencies"
              description="Exchange rates refresh nightly."
              actions={
                <>
                  <Button variant="outline" size="sm">
                    Import
                  </Button>
                  <Button size="sm">
                    <Plus className="size-4" /> Add currency
                  </Button>
                </>
              }
            />
            <PageBody>
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Page content
              </div>
            </PageBody>
          </Page>
        </div>
      ),
      code: `import { Plus } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'

<Page>
  <PageHeader
    title={t('currencies.list.title')}
    actions={
      <>
        <Button variant="outline" size="sm">Import</Button>
        <Button size="sm"><Plus className="size-4" /> Add currency</Button>
      </>
    }
  />
  <PageBody>{/* … */}</PageBody>
</Page>`,
    },
  ],
}

const sectionHeaderEntry: GalleryEntry = {
  id: 'section-header',
  title: 'SectionHeader',
  importPath: '@open-mercato/ui/backend/SectionHeader',
  variants: [
    {
      id: 'count-and-action',
      title: 'With count and action',
      render: () => (
        <div className="w-full max-w-md">
          <SectionHeader
            title="Addresses"
            count={3}
            action={
              <Button variant="ghost" size="sm">
                <Plus className="size-4" /> Add
              </Button>
            }
          />
        </div>
      ),
      code: `import { Plus } from 'lucide-react'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'

<SectionHeader
  title={t('customers.people.detail.addresses.title')}
  count={addresses.length}
  action={<Button variant="ghost" size="sm"><Plus className="size-4" /> {t('common.add')}</Button>}
/>`,
    },
    {
      id: 'collapsible',
      title: 'CollapsibleSection',
      render: () => (
        <div className="w-full max-w-md">
          <CollapsibleSection title="Billing details" count={2}>
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Section content
            </div>
          </CollapsibleSection>
        </div>
      ),
      code: `import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'

<CollapsibleSection title={t('billing.details.title')} count={2}>
  {/* section content */}
</CollapsibleSection>`,
    },
  ],
}

const sectionPageEntry: GalleryEntry = {
  id: 'section-page',
  title: 'SectionPage',
  importPath: '@open-mercato/ui/backend/section-page',
  variants: [
    {
      id: 'miniature',
      title: 'Two-item miniature (clipped frame)',
      render: () => <SectionPageMiniDemo />,
      code: `import { UserRound, Lock } from 'lucide-react'
import { SectionPage, type SectionNavGroup } from '@open-mercato/ui/backend/section-page'

const sections: SectionNavGroup[] = [
  {
    id: 'account',
    label: 'Account',
    items: [
      { id: 'profile', label: 'Profile', href: '/backend/profile', icon: <UserRound className="size-4" /> },
      { id: 'security', label: 'Security', href: '/backend/profile/security', icon: <Lock className="size-4" /> },
    ],
  },
]

<SectionPage title={t('profile.title')} sections={sections} activePath={pathname}>
  {children}
</SectionPage>`,
    },
    {
      id: 'section-nav',
      title: 'SectionNav (standalone, controlled collapse)',
      render: () => <SectionNavDemo />,
      code: `import { SectionNav, type SectionNavGroup } from '@open-mercato/ui/backend/section-page'

const [collapsed, setCollapsed] = React.useState(false)

<SectionNav
  title={t('profile.title')}
  sections={sections}
  activePath={pathname}
  collapsed={collapsed}
  onToggleCollapse={() => setCollapsed((value) => !value)}
/>`,
    },
  ],
}

const formHeaderEntry: GalleryEntry = {
  id: 'form-header',
  title: 'FormHeader',
  importPath: '@open-mercato/ui/backend/forms',
  variants: [
    {
      id: 'edit-mode',
      title: 'Edit mode',
      render: () => (
        <div className="w-full">
          <FormHeader
            backHref="#form-header"
            backLabel="Back"
            title="Edit product"
            actions={{
              cancelHref: '#form-header',
              cancelLabel: 'Cancel',
              submit: { label: 'Save', pendingLabel: 'Saving…' },
            }}
          />
        </div>
      ),
      code: `import { FormHeader } from '@open-mercato/ui/backend/forms'

<FormHeader
  backHref="/backend/products"
  backLabel={t('ui.navigation.back')}
  title={t('products.edit.title')}
  actions={{
    cancelHref: '/backend/products',
    cancelLabel: t('ui.forms.actions.cancel'),
    submit: { formId: 'product-form', label: t('ui.forms.actions.save'), pendingLabel: t('ui.forms.actions.saving') },
  }}
/>`,
    },
    {
      id: 'detail-mode',
      title: 'Detail mode',
      render: () => (
        <div className="w-full">
          <FormHeader
            mode="detail"
            backHref="#form-header"
            entityTypeLabel="Company"
            title="Acme Logistics"
            subtitle="Created 12 Mar 2026"
            statusBadge={<Badge variant="muted">Active</Badge>}
            menuActions={[
              { id: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: () => {} },
              { id: 'archive', label: 'Archive', icon: Archive, onSelect: () => {} },
            ]}
            onDelete={() => {}}
            deleteLabel="Delete"
          />
        </div>
      ),
      code: `import { Archive, Copy } from 'lucide-react'
import { FormHeader } from '@open-mercato/ui/backend/forms'

<FormHeader
  mode="detail"
  backHref="/backend/customers/companies"
  entityTypeLabel={t('customers.companies.detail.entityType')}
  title={company.name}
  subtitle={t('customers.companies.detail.createdAt', { date: createdAt })}
  statusBadge={<Badge variant="muted">{statusLabel}</Badge>}
  menuActions={[
    { id: 'duplicate', label: t('ui.actions.duplicate'), icon: Copy, onSelect: duplicate },
    { id: 'archive', label: t('ui.actions.archive'), icon: Archive, onSelect: archive },
  ]}
  onDelete={confirmDelete}
  deleteLabel={t('ui.forms.actions.delete')}
/>`,
    },
  ],
}

const formFooterEntry: GalleryEntry = {
  id: 'form-footer',
  title: 'FormFooter',
  importPath: '@open-mercato/ui/backend/forms',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <div className="w-full">
          <FormFooter
            actions={{
              cancelHref: '#form-footer',
              cancelLabel: 'Cancel',
              submit: { label: 'Save changes', pendingLabel: 'Saving…' },
            }}
          />
        </div>
      ),
      code: `import { FormFooter } from '@open-mercato/ui/backend/forms'

<FormFooter
  actions={{
    cancelHref: '/backend/products',
    cancelLabel: t('ui.forms.actions.cancel'),
    submit: { formId: 'product-form', label: t('ui.forms.actions.save'), pendingLabel: t('ui.forms.actions.saving') },
  }}
/>`,
    },
    {
      id: 'embedded-with-delete',
      title: 'embedded, with delete',
      render: () => (
        <div className="w-full">
          <FormFooter
            embedded
            actions={{
              showDelete: true,
              onDelete: () => {},
              deleteLabel: 'Delete',
              cancelHref: '#form-footer',
              cancelLabel: 'Cancel',
              submit: { label: 'Save' },
            }}
          />
        </div>
      ),
      code: `import { FormFooter } from '@open-mercato/ui/backend/forms'

<FormFooter
  embedded
  actions={{
    showDelete: true,
    onDelete: confirmDelete,
    deleteLabel: t('ui.forms.actions.delete'),
    cancelHref: '/backend/products',
    cancelLabel: t('ui.forms.actions.cancel'),
    submit: { label: t('ui.forms.actions.save') },
  }}
/>`,
    },
  ],
}

const actionsDropdownEntry: GalleryEntry = {
  id: 'actions-dropdown',
  title: 'ActionsDropdown',
  importPath: '@open-mercato/ui/backend/forms',
  variants: [
    {
      id: 'label-trigger',
      title: 'Label trigger',
      render: () => <ActionsDropdown items={demoActions} />,
      code: `import { Copy, Download, Trash2 } from 'lucide-react'
import { ActionsDropdown, type ActionItem } from '@open-mercato/ui/backend/forms'

const items: ActionItem[] = [
  { id: 'duplicate', label: t('ui.actions.duplicate'), icon: Copy, onSelect: duplicate },
  { id: 'export', label: t('ui.actions.export'), icon: Download, onSelect: exportCsv },
  { id: 'delete', label: t('ui.actions.delete'), icon: Trash2, onSelect: confirmDelete },
]

<ActionsDropdown items={items} />`,
    },
    {
      id: 'icon-trigger',
      title: 'Icon trigger',
      render: () => (
        <ActionsDropdown items={demoActions} triggerMode="icon" ariaLabel="More actions" />
      ),
      code: `import { ActionsDropdown } from '@open-mercato/ui/backend/forms'

<ActionsDropdown items={items} triggerMode="icon" ariaLabel={t('ui.actions.more')} />`,
    },
  ],
}

export const entries: GalleryEntry[] = [
  pageEntry,
  sectionHeaderEntry,
  sectionPageEntry,
  formHeaderEntry,
  formFooterEntry,
  actionsDropdownEntry,
]
