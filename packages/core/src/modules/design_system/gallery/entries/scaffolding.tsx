import { useT } from '@open-mercato/shared/lib/i18n/context'
import * as React from 'react'
import { CryptocurrencyDemo } from '../demos/cryptocurrency'
import { Archive, Copy, Download, Lock, Plus, Trash2, UserRound } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { CollapsibleSection, SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { SectionNav, SectionPage, type SectionNavGroup } from '@open-mercato/ui/backend/section-page'
import { ActionsDropdown, FormFooter, FormHeader, type ActionItem } from '@open-mercato/ui/backend/forms'
import { PageHeaderExample } from '../demos/shell'
import { shellExampleCode } from '../demos/shell-code.generated'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

// The demos use `#`-anchors as hrefs so clicking inside the gallery never
// navigates away, and every callback is a no-op.
function PageEntryBasicPreview() {
  const t = useT()
  return (
    <div className="w-full">
      <Page>
        <PageHeader
          title={t('design_system.gallery.samples.content.currencies')}
          description={t('design_system.gallery.samples.content.exchangeRatesRefreshNightly')}
        />
        <PageBody>
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            {t('design_system.gallery.samples.content.pageContent')}
          </div>
        </PageBody>
      </Page>
    </div>
  )
}
function PageEntryWithActionsPreview() {
  const t = useT()
  return (
    <div className="w-full">
      <Page>
        <PageHeader
          title={t('design_system.gallery.samples.content.currencies')}
          description={t('design_system.gallery.samples.content.exchangeRatesRefreshNightly')}
          actions={
            <>
              <Button variant="outline" size="sm">
                {t('design_system.gallery.samples.content.import')}
              </Button>
              <Button size="sm">
                <Plus className="size-4" />
                {t('design_system.gallery.samples.content.addCurrency')}
              </Button>
            </>
          }
        />
        <PageBody>
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            {t('design_system.gallery.samples.content.pageContent')}
          </div>
        </PageBody>
      </Page>
    </div>
  )
}
function SectionHeaderEntryCountAndActionPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-md">
      <SectionHeader
        title={t('design_system.gallery.samples.content.addresses')}
        count={3}
        action={
          <Button variant="ghost" size="sm">
            <Plus className="size-4" />
            {t('design_system.gallery.samples.content.add')}
          </Button>
        }
      />
    </div>
  )
}
function SectionHeaderEntryCollapsiblePreview() {
  const t = useT()
  return (
    <div className="w-full max-w-md">
      <CollapsibleSection title={t('design_system.gallery.samples.content.billingDetails')} count={2}>
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {t('design_system.gallery.samples.content.sectionContent')}
        </div>
      </CollapsibleSection>
    </div>
  )
}
function FormHeaderEntryEditModePreview() {
  const t = useT()
  return (
    <div className="w-full">
      <FormHeader
        backHref="#form-header"
        backLabel={t('design_system.gallery.samples.content.back')}
        title={t('design_system.gallery.samples.content.editProduct')}
        actions={{
          cancelHref: '#form-header',
          cancelLabel: 'Cancel',
          submit: {
            label: t('design_system.gallery.samples.content.save'),
            pendingLabel: 'Saving…',
          },
        }}
      />
    </div>
  )
}
function FormHeaderEntryDetailModePreview() {
  const t = useT()
  return (
    <div className="w-full">
      <FormHeader
        mode="detail"
        backHref="#form-header"
        entityTypeLabel={t('design_system.gallery.samples.content.company')}
        title="Acme Logistics"
        subtitle={t('design_system.gallery.samples.content.created12Mar2026')}
        statusBadge={<Badge variant="muted">{t('design_system.gallery.samples.content.active')}</Badge>}
        menuActions={[
          {
            id: 'duplicate',
            label: t('design_system.gallery.samples.content.duplicate'),
            icon: Copy,
            onSelect: () => {},
          },
          {
            id: 'archive',
            label: t('design_system.gallery.samples.content.archive'),
            icon: Archive,
            onSelect: () => {},
          },
        ]}
        onDelete={() => {}}
        deleteLabel={t('design_system.gallery.samples.content.delete')}
      />
    </div>
  )
}
function FormFooterEntryDefaultPreview() {
  const t = useT()
  return (
    <div className="w-full">
      <FormFooter
        actions={{
          cancelHref: '#form-footer',
          cancelLabel: 'Cancel',
          submit: {
            label: t('design_system.gallery.samples.content.saveChanges'),
            pendingLabel: 'Saving…',
          },
        }}
      />
    </div>
  )
}
function FormFooterEntryEmbeddedWithDeletePreview() {
  const t = useT()
  return (
    <div className="w-full">
      <FormFooter
        embedded
        actions={{
          showDelete: true,
          onDelete: () => {},
          deleteLabel: t('design_system.gallery.samples.content.delete'),
          cancelHref: '#form-footer',
          cancelLabel: 'Cancel',
          submit: {
            label: t('design_system.gallery.samples.content.save'),
          },
        }}
      />
    </div>
  )
}
function ActionsDropdownEntryLabelTriggerPreview() {
  const t = useT()
  return <ActionsDropdown items={demoActions(t)} />
}
function ActionsDropdownEntryIconTriggerPreview() {
  const t = useT()
  return (
    <ActionsDropdown
      items={demoActions(t)}
      triggerMode="icon"
      ariaLabel={t('design_system.gallery.samples.content.moreActions')}
    />
  )
}
const demoSections = (t: ReturnType<typeof useT>): SectionNavGroup[] => [
  {
    id: 'account',
    label: t('design_system.gallery.samples.content.account'),
    items: [
      {
        id: 'profile',
        label: t('design_system.gallery.samples.content.profile'),
        href: '#profile',
        icon: <UserRound className="size-4" />,
      },
      {
        id: 'security',
        label: t('design_system.gallery.samples.content.security'),
        href: '#security',
        icon: <Lock className="size-4" />,
      },
    ],
  },
]
function SectionPageMiniDemo() {
  const t = useT()
  return (
    <div
      data-example="section-page"
      className="w-full rounded-lg border border-border bg-background [&>div]:h-auto [&>div]:min-h-0 [&>div]:flex-col sm:[&>div]:flex-row [&>div>aside]:w-auto [&_main]:min-w-0 [&_main]:overflow-visible"
    >
      <SectionPage
        title={t('design_system.gallery.samples.content.settings')}
        sections={demoSections(t)}
        activePath="#profile"
      >
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">{t('design_system.gallery.samples.content.profile')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('design_system.gallery.samples.content.sectionContentRendersHere')}
          </p>
        </div>
      </SectionPage>
    </div>
  )
}

// SectionNav is controlled — the demo owns the collapsed state.
function SectionNavDemo() {
  const t = useT()
  const [collapsed, setCollapsed] = React.useState(false)
  return (
    <div className="w-64 rounded-lg border bg-background px-3 py-4">
      <SectionNav
        title={t('design_system.gallery.samples.content.settings')}
        sections={demoSections(t)}
        activePath="#profile"
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((value) => !value)}
      />
    </div>
  )
}
const demoActions = (t: ReturnType<typeof useT>): ActionItem[] => [
  {
    id: 'duplicate',
    label: t('design_system.gallery.samples.content.duplicateRecord'),
    icon: Copy,
    onSelect: () => {},
  },
  {
    id: 'export',
    label: t('design_system.gallery.samples.content.exportAsCsv'),
    icon: Download,
    onSelect: () => {},
  },
  {
    id: 'delete',
    label: t('design_system.gallery.samples.content.deleteRecord'),
    icon: Trash2,
    onSelect: () => {},
  },
]
const pageEntry: GalleryEntry = {
  id: 'page',
  figmaNodeId: '3829:27898',
  title: 'Page',
  importPath: '@open-mercato/ui/backend/Page',
  variants: [
    {
      id: 'basic',
      title: 'Page + PageHeader + PageBody',
      render: () => <PageEntryBasicPreview />,
      code: `import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'

<Page>
  <PageHeader title={t('currencies.list.title')} description={t('design_system.gallery.samples.listDescription')} />
  <PageBody>{/* DataTable, sections… */}</PageBody>
</Page>`,
    },
    {
      id: 'with-actions',
      title: 'Header actions',
      render: () => <PageEntryWithActionsPreview />,
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
    {
      id: 'source-page-basic',
      title: 'Page header / basic',
      render: () => <PageHeaderExample appearance="page" type="basic" />,
      code: shellExampleCode('<PageHeaderExample appearance="page" type="basic" />'),
    },
    {
      id: 'source-page-avatar',
      title: 'Page header / avatar',
      render: () => <PageHeaderExample appearance="page" type="avatar" />,
      code: shellExampleCode('<PageHeaderExample appearance="page" type="avatar" />'),
    },
    {
      id: 'source-page-icon',
      title: 'Page header / icon',
      render: () => <PageHeaderExample appearance="page" type="icon" />,
      code: shellExampleCode('<PageHeaderExample appearance="page" type="icon" />'),
    },
    {
      id: 'source-page-brand',
      title: 'Page header / brand',
      render: () => <PageHeaderExample appearance="page" type="brand" />,
      code: shellExampleCode('<PageHeaderExample appearance="page" type="brand" />'),
    },
    {
      id: 'source-page-company',
      title: 'Page header / company',
      render: () => <PageHeaderExample appearance="page" type="company" />,
      code: shellExampleCode('<PageHeaderExample appearance="page" type="company" />'),
    },
    {
      id: 'source-section-basic',
      title: 'Section header / basic',
      render: () => <PageHeaderExample appearance="section" type="basic" />,
      code: shellExampleCode('<PageHeaderExample appearance="section" type="basic" />'),
    },
    {
      id: 'source-section-avatar',
      title: 'Section header / avatar',
      render: () => <PageHeaderExample appearance="section" type="avatar" />,
      code: shellExampleCode('<PageHeaderExample appearance="section" type="avatar" />'),
    },
    {
      id: 'source-section-icon',
      title: 'Section header / icon',
      render: () => <PageHeaderExample appearance="section" type="icon" />,
      code: shellExampleCode('<PageHeaderExample appearance="section" type="icon" />'),
    },
    {
      id: 'source-section-brand',
      title: 'Section header / brand',
      render: () => <PageHeaderExample appearance="section" type="brand" />,
      code: shellExampleCode('<PageHeaderExample appearance="section" type="brand" />'),
    },
    {
      id: 'source-section-company',
      title: 'Section header / company',
      render: () => <PageHeaderExample appearance="section" type="company" />,
      code: shellExampleCode('<PageHeaderExample appearance="section" type="company" />'),
    },
    {
      id: 'source-page-options',
      title: 'Page header / optional content',
      render: () => <PageHeaderExample appearance="page" type="company" configurable />,
      code: shellExampleCode('<PageHeaderExample appearance="page" type="company" configurable />'),
    },
    {
      id: 'source-section-options',
      title: 'Section header / optional content',
      render: () => <PageHeaderExample appearance="section" type="company" configurable />,
      code: shellExampleCode('<PageHeaderExample appearance="section" type="company" configurable />'),
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
      render: () => <SectionHeaderEntryCountAndActionPreview />,
      code: `import { Plus } from 'lucide-react'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'

<SectionHeader
  title={t('design_system.gallery.samples.addresses.title')}
  count={addresses.length}
  action={<Button variant="ghost" size="sm"><Plus className="size-4" /> {t('common.add')}</Button>}
/>`,
    },
    {
      id: 'collapsible',
      title: 'CollapsibleSection',
      render: () => <SectionHeaderEntryCollapsiblePreview />,
      code: `import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'

<CollapsibleSection title={t('design_system.gallery.samples.billingDetails')} count={2}>
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
      title: 'Two-item responsive section layout',
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

<SectionPage title={t('profile.page.title')} sections={sections} activePath={pathname}>
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
  title={t('profile.page.title')}
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
      render: () => <FormHeaderEntryEditModePreview />,
      code: `import { FormHeader } from '@open-mercato/ui/backend/forms'

<FormHeader
  backHref="/backend/products"
  backLabel={t('ui.navigation.back')}
  title={t('catalog.products.edit.title')}
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
      render: () => <FormHeaderEntryDetailModePreview />,
      code: `import { Archive, Copy } from 'lucide-react'
import { FormHeader } from '@open-mercato/ui/backend/forms'

<FormHeader
  mode="detail"
  backHref="/backend/customers/companies"
  entityTypeLabel={t('design_system.gallery.samples.entityType')}
  title={company.name}
  subtitle={t('design_system.gallery.samples.createdAt', { date: createdAt })}
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
      render: () => <FormFooterEntryDefaultPreview />,
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
      render: () => <FormFooterEntryEmbeddedWithDeletePreview />,
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
      render: () => <ActionsDropdownEntryLabelTriggerPreview />,
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
      render: () => <ActionsDropdownEntryIconTriggerPreview />,
      code: `import { ActionsDropdown } from '@open-mercato/ui/backend/forms'

<ActionsDropdown items={items} triggerMode="icon" ariaLabel={t('ui.actions.more')} />`,
    },
  ],
}
// A composed pattern, not a primitive: the snippet points at the demo module instead of
// embedding its full source, and the import path says so honestly.
const cryptocurrencyPatternCode = (expression: string) => `import { CryptocurrencyDemo } from '@open-mercato/core/modules/design_system/gallery/demos/cryptocurrency'

${expression}
`

const cryptocurrencyEntry: GalleryEntry = {
  id: 'cryptocurrency',
  title: 'Cryptocurrency',
  descriptionKey: 'design_system.entries.cryptocurrency.description',
  importPath: '@open-mercato/core/modules/design_system/gallery/demos/cryptocurrency',
  figmaNodeId: '6696:81120',
  variants: [
    {
      id: 'token-icon-btc',
      title: 'token-icon-btc',
      render: () => <CryptocurrencyDemo part="token-icon" kind="btc" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="token-icon" kind="btc" />'),
    },
    {
      id: 'token-icon-eth',
      title: 'token-icon-eth',
      render: () => <CryptocurrencyDemo part="token-icon" kind="eth" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="token-icon" kind="eth" />'),
    },
    {
      id: 'token-icon-xrp',
      title: 'token-icon-xrp',
      render: () => <CryptocurrencyDemo part="token-icon" kind="xrp" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="token-icon" kind="xrp" />'),
    },
    {
      id: 'token-icon-usdt',
      title: 'token-icon-usdt',
      render: () => <CryptocurrencyDemo part="token-icon" kind="usdt" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="token-icon" kind="usdt" />'),
    },
    {
      id: 'token-icon-bnb',
      title: 'token-icon-bnb',
      render: () => <CryptocurrencyDemo part="token-icon" kind="bnb" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="token-icon" kind="bnb" />'),
    },
    {
      id: 'token-icon-sol',
      title: 'token-icon-sol',
      render: () => <CryptocurrencyDemo part="token-icon" kind="sol" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="token-icon" kind="sol" />'),
    },
    {
      id: 'token-icon-usdc',
      title: 'token-icon-usdc',
      render: () => <CryptocurrencyDemo part="token-icon" kind="usdc" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="token-icon" kind="usdc" />'),
    },
    {
      id: 'token-icon-trx',
      title: 'token-icon-trx',
      render: () => <CryptocurrencyDemo part="token-icon" kind="trx" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="token-icon" kind="trx" />'),
    },
    {
      id: 'token-icon-ada',
      title: 'token-icon-ada',
      render: () => <CryptocurrencyDemo part="token-icon" kind="ada" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="token-icon" kind="ada" />'),
    },
    {
      id: 'token-icon-avax',
      title: 'token-icon-avax',
      render: () => <CryptocurrencyDemo part="token-icon" kind="avax" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="token-icon" kind="avax" />'),
    },
    {
      id: 'token-icon-hbar',
      title: 'token-icon-hbar',
      render: () => <CryptocurrencyDemo part="token-icon" kind="hbar" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="token-icon" kind="hbar" />'),
    },
    {
      id: 'token-icon-dot',
      title: 'token-icon-dot',
      render: () => <CryptocurrencyDemo part="token-icon" kind="dot" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="token-icon" kind="dot" />'),
    },
    {
      id: 'status-icon-success',
      title: 'status-icon-success',
      render: () => <CryptocurrencyDemo part="status-icon" kind="success" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="status-icon" kind="success" />'),
    },
    {
      id: 'status-icon-pending',
      title: 'status-icon-pending',
      render: () => <CryptocurrencyDemo part="status-icon" kind="pending" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="status-icon" kind="pending" />'),
    },
    {
      id: 'status-icon-warning',
      title: 'status-icon-warning',
      render: () => <CryptocurrencyDemo part="status-icon" kind="warning" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="status-icon" kind="warning" />'),
    },
    {
      id: 'status-icon-cancelled',
      title: 'status-icon-cancelled',
      render: () => <CryptocurrencyDemo part="status-icon" kind="cancelled" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="status-icon" kind="cancelled" />'),
    },
    {
      id: 'navigation-item-default-28',
      title: 'navigation-item-default-28',
      render: () => <CryptocurrencyDemo part="navigation-item" state="default" size={28} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-item" state="default" size={28} />'),
    },
    {
      id: 'navigation-item-hover-28',
      title: 'navigation-item-hover-28',
      render: () => <CryptocurrencyDemo part="navigation-item" state="hover" size={28} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-item" state="hover" size={28} />'),
    },
    {
      id: 'navigation-item-active-28',
      title: 'navigation-item-active-28',
      render: () => <CryptocurrencyDemo part="navigation-item" state="active" size={28} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-item" state="active" size={28} />'),
    },
    {
      id: 'navigation-item-default-24',
      title: 'navigation-item-default-24',
      render: () => <CryptocurrencyDemo part="navigation-item" state="default" size={24} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-item" state="default" size={24} />'),
    },
    {
      id: 'navigation-item-hover-24',
      title: 'navigation-item-hover-24',
      render: () => <CryptocurrencyDemo part="navigation-item" state="hover" size={24} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-item" state="hover" size={24} />'),
    },
    {
      id: 'navigation-item-active-24',
      title: 'navigation-item-active-24',
      render: () => <CryptocurrencyDemo part="navigation-item" state="active" size={24} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-item" state="active" size={24} />'),
    },
    {
      id: 'navigation-search-default',
      title: 'navigation-search-default',
      render: () => <CryptocurrencyDemo part="navigation-search" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-search" state="default" />'),
    },
    {
      id: 'navigation-search-hover',
      title: 'navigation-search-hover',
      render: () => <CryptocurrencyDemo part="navigation-search" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-search" state="hover" />'),
    },
    {
      id: 'navigation-wallet-default',
      title: 'navigation-wallet-default',
      render: () => <CryptocurrencyDemo part="navigation-wallet" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-wallet" state="default" />'),
    },
    {
      id: 'navigation-wallet-hover',
      title: 'navigation-wallet-hover',
      render: () => <CryptocurrencyDemo part="navigation-wallet" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-wallet" state="hover" />'),
    },
    {
      id: 'navigation-wallet-active',
      title: 'navigation-wallet-active',
      render: () => <CryptocurrencyDemo part="navigation-wallet" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-wallet" state="active" />'),
    },
    {
      id: 'navigation-action-favorite-default',
      title: 'navigation-action-favorite-default',
      render: () => <CryptocurrencyDemo part="navigation-action" kind="favorite" state="default" />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="navigation-action" kind="favorite" state="default" />',
      ),
    },
    {
      id: 'navigation-action-notification-default',
      title: 'navigation-action-notification-default',
      render: () => <CryptocurrencyDemo part="navigation-action" kind="notification" state="default" />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="navigation-action" kind="notification" state="default" />',
      ),
    },
    {
      id: 'navigation-action-hamburger-default',
      title: 'navigation-action-hamburger-default',
      render: () => <CryptocurrencyDemo part="navigation-action" kind="hamburger" state="default" />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="navigation-action" kind="hamburger" state="default" />',
      ),
    },
    {
      id: 'navigation-action-favorite-hover',
      title: 'navigation-action-favorite-hover',
      render: () => <CryptocurrencyDemo part="navigation-action" kind="favorite" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-action" kind="favorite" state="hover" />'),
    },
    {
      id: 'navigation-action-notification-hover',
      title: 'navigation-action-notification-hover',
      render: () => <CryptocurrencyDemo part="navigation-action" kind="notification" state="hover" />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="navigation-action" kind="notification" state="hover" />',
      ),
    },
    {
      id: 'navigation-action-hamburger-hover',
      title: 'navigation-action-hamburger-hover',
      render: () => <CryptocurrencyDemo part="navigation-action" kind="hamburger" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-action" kind="hamburger" state="hover" />'),
    },
    {
      id: 'navigation-action-favorite-active',
      title: 'navigation-action-favorite-active',
      render: () => <CryptocurrencyDemo part="navigation-action" kind="favorite" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation-action" kind="favorite" state="active" />'),
    },
    {
      id: 'navigation-action-notification-active',
      title: 'navigation-action-notification-active',
      render: () => <CryptocurrencyDemo part="navigation-action" kind="notification" state="active" />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="navigation-action" kind="notification" state="active" />',
      ),
    },
    {
      id: 'navigation-action-hamburger-active',
      title: 'navigation-action-hamburger-active',
      render: () => <CryptocurrencyDemo part="navigation-action" kind="hamburger" state="active" />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="navigation-action" kind="hamburger" state="active" />',
      ),
    },
    {
      id: 'chart-item-default',
      title: 'chart-item-default',
      render: () => <CryptocurrencyDemo part="chart-item" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="chart-item" state="default" />'),
    },
    {
      id: 'chart-item-hover',
      title: 'chart-item-hover',
      render: () => <CryptocurrencyDemo part="chart-item" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="chart-item" state="hover" />'),
    },
    {
      id: 'chart-item-active',
      title: 'chart-item-active',
      render: () => <CryptocurrencyDemo part="chart-item" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="chart-item" state="active" />'),
    },
    {
      id: 'swap-select-lighter-default',
      title: 'swap-select-lighter-default',
      render: () => <CryptocurrencyDemo part="swap-select" kind="lighter" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-select" kind="lighter" state="default" />'),
    },
    {
      id: 'swap-select-lighter-hover',
      title: 'swap-select-lighter-hover',
      render: () => <CryptocurrencyDemo part="swap-select" kind="lighter" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-select" kind="lighter" state="hover" />'),
    },
    {
      id: 'swap-select-lighter-active',
      title: 'swap-select-lighter-active',
      render: () => <CryptocurrencyDemo part="swap-select" kind="lighter" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-select" kind="lighter" state="active" />'),
    },
    {
      id: 'swap-select-stroke-default',
      title: 'swap-select-stroke-default',
      render: () => <CryptocurrencyDemo part="swap-select" kind="stroke" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-select" kind="stroke" state="default" />'),
    },
    {
      id: 'swap-select-stroke-hover',
      title: 'swap-select-stroke-hover',
      render: () => <CryptocurrencyDemo part="swap-select" kind="stroke" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-select" kind="stroke" state="hover" />'),
    },
    {
      id: 'swap-select-stroke-active',
      title: 'swap-select-stroke-active',
      render: () => <CryptocurrencyDemo part="swap-select" kind="stroke" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-select" kind="stroke" state="active" />'),
    },
    {
      id: 'chart-switch-1d',
      title: 'chart-switch-1d',
      render: () => <CryptocurrencyDemo part="chart-switch" kind="1D" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="chart-switch" kind="1D" />'),
    },
    {
      id: 'chart-switch-1w',
      title: 'chart-switch-1w',
      render: () => <CryptocurrencyDemo part="chart-switch" kind="1W" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="chart-switch" kind="1W" />'),
    },
    {
      id: 'chart-switch-1m',
      title: 'chart-switch-1m',
      render: () => <CryptocurrencyDemo part="chart-switch" kind="1M" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="chart-switch" kind="1M" />'),
    },
    {
      id: 'chart-switch-3m',
      title: 'chart-switch-3m',
      render: () => <CryptocurrencyDemo part="chart-switch" kind="3M" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="chart-switch" kind="3M" />'),
    },
    {
      id: 'chart-switch-1y',
      title: 'chart-switch-1y',
      render: () => <CryptocurrencyDemo part="chart-switch" kind="1Y" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="chart-switch" kind="1Y" />'),
    },
    {
      id: 'table-button-explorer-default',
      title: 'table-button-explorer-default',
      render: () => <CryptocurrencyDemo part="table-button" kind="explorer" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-button" kind="explorer" state="default" />'),
    },
    {
      id: 'table-button-detail-default',
      title: 'table-button-detail-default',
      render: () => <CryptocurrencyDemo part="table-button" kind="detail" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-button" kind="detail" state="default" />'),
    },
    {
      id: 'table-button-explorer-hover',
      title: 'table-button-explorer-hover',
      render: () => <CryptocurrencyDemo part="table-button" kind="explorer" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-button" kind="explorer" state="hover" />'),
    },
    {
      id: 'table-button-detail-hover',
      title: 'table-button-detail-hover',
      render: () => <CryptocurrencyDemo part="table-button" kind="detail" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-button" kind="detail" state="hover" />'),
    },
    {
      id: 'table-button-explorer-active',
      title: 'table-button-explorer-active',
      render: () => <CryptocurrencyDemo part="table-button" kind="explorer" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-button" kind="explorer" state="active" />'),
    },
    {
      id: 'table-button-detail-active',
      title: 'table-button-detail-active',
      render: () => <CryptocurrencyDemo part="table-button" kind="detail" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-button" kind="detail" state="active" />'),
    },
    {
      id: 'table-switch-item-default',
      title: 'table-switch-item-default',
      render: () => <CryptocurrencyDemo part="table-switch-item" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-switch-item" state="default" />'),
    },
    {
      id: 'table-switch-item-hover',
      title: 'table-switch-item-hover',
      render: () => <CryptocurrencyDemo part="table-switch-item" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-switch-item" state="hover" />'),
    },
    {
      id: 'table-switch-item-active',
      title: 'table-switch-item-active',
      render: () => <CryptocurrencyDemo part="table-switch-item" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-switch-item" state="active" />'),
    },
    {
      id: 'table-tab-transaction-default',
      title: 'table-tab-transaction-default',
      render: () => <CryptocurrencyDemo part="table-tab" kind="transaction" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-tab" kind="transaction" state="default" />'),
    },
    {
      id: 'table-tab-open-orders-default',
      title: 'table-tab-open-orders-default',
      render: () => <CryptocurrencyDemo part="table-tab" kind="open-orders" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-tab" kind="open-orders" state="default" />'),
    },
    {
      id: 'table-tab-earn-rewards-default',
      title: 'table-tab-earn-rewards-default',
      render: () => <CryptocurrencyDemo part="table-tab" kind="earn-rewards" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-tab" kind="earn-rewards" state="default" />'),
    },
    {
      id: 'table-tab-transaction-hover',
      title: 'table-tab-transaction-hover',
      render: () => <CryptocurrencyDemo part="table-tab" kind="transaction" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-tab" kind="transaction" state="hover" />'),
    },
    {
      id: 'table-tab-open-orders-hover',
      title: 'table-tab-open-orders-hover',
      render: () => <CryptocurrencyDemo part="table-tab" kind="open-orders" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-tab" kind="open-orders" state="hover" />'),
    },
    {
      id: 'table-tab-earn-rewards-hover',
      title: 'table-tab-earn-rewards-hover',
      render: () => <CryptocurrencyDemo part="table-tab" kind="earn-rewards" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-tab" kind="earn-rewards" state="hover" />'),
    },
    {
      id: 'table-tab-transaction-active',
      title: 'table-tab-transaction-active',
      render: () => <CryptocurrencyDemo part="table-tab" kind="transaction" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-tab" kind="transaction" state="active" />'),
    },
    {
      id: 'table-tab-open-orders-active',
      title: 'table-tab-open-orders-active',
      render: () => <CryptocurrencyDemo part="table-tab" kind="open-orders" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-tab" kind="open-orders" state="active" />'),
    },
    {
      id: 'table-tab-earn-rewards-active',
      title: 'table-tab-earn-rewards-active',
      render: () => <CryptocurrencyDemo part="table-tab" kind="earn-rewards" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-tab" kind="earn-rewards" state="active" />'),
    },
    {
      id: 'table-filter-type-default',
      title: 'table-filter-type-default',
      render: () => <CryptocurrencyDemo part="table-filter" kind="type" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="type" state="default" />'),
    },
    {
      id: 'table-filter-date-default',
      title: 'table-filter-date-default',
      render: () => <CryptocurrencyDemo part="table-filter" kind="date" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="date" state="default" />'),
    },
    {
      id: 'table-filter-token-default',
      title: 'table-filter-token-default',
      render: () => <CryptocurrencyDemo part="table-filter" kind="token" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="token" state="default" />'),
    },
    {
      id: 'table-filter-status-default',
      title: 'table-filter-status-default',
      render: () => <CryptocurrencyDemo part="table-filter" kind="status" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="status" state="default" />'),
    },
    {
      id: 'table-filter-date-hover',
      title: 'table-filter-date-hover',
      render: () => <CryptocurrencyDemo part="table-filter" kind="date" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="date" state="hover" />'),
    },
    {
      id: 'table-filter-type-hover',
      title: 'table-filter-type-hover',
      render: () => <CryptocurrencyDemo part="table-filter" kind="type" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="type" state="hover" />'),
    },
    {
      id: 'table-filter-date-active',
      title: 'table-filter-date-active',
      render: () => <CryptocurrencyDemo part="table-filter" kind="date" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="date" state="active" />'),
    },
    {
      id: 'table-filter-token-hover',
      title: 'table-filter-token-hover',
      render: () => <CryptocurrencyDemo part="table-filter" kind="token" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="token" state="hover" />'),
    },
    {
      id: 'table-filter-status-hover',
      title: 'table-filter-status-hover',
      render: () => <CryptocurrencyDemo part="table-filter" kind="status" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="status" state="hover" />'),
    },
    {
      id: 'table-filter-date-selected',
      title: 'table-filter-date-selected',
      render: () => <CryptocurrencyDemo part="table-filter" kind="date" state="selected" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="date" state="selected" />'),
    },
    {
      id: 'table-filter-type-active',
      title: 'table-filter-type-active',
      render: () => <CryptocurrencyDemo part="table-filter" kind="type" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="type" state="active" />'),
    },
    {
      id: 'table-filter-token-active',
      title: 'table-filter-token-active',
      render: () => <CryptocurrencyDemo part="table-filter" kind="token" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="token" state="active" />'),
    },
    {
      id: 'table-filter-status-active',
      title: 'table-filter-status-active',
      render: () => <CryptocurrencyDemo part="table-filter" kind="status" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="status" state="active" />'),
    },
    {
      id: 'table-filter-type-selected',
      title: 'table-filter-type-selected',
      render: () => <CryptocurrencyDemo part="table-filter" kind="type" state="selected" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="type" state="selected" />'),
    },
    {
      id: 'table-filter-token-selected',
      title: 'table-filter-token-selected',
      render: () => <CryptocurrencyDemo part="table-filter" kind="token" state="selected" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="token" state="selected" />'),
    },
    {
      id: 'table-filter-status-selected',
      title: 'table-filter-status-selected',
      render: () => <CryptocurrencyDemo part="table-filter" kind="status" state="selected" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-filter" kind="status" state="selected" />'),
    },
    {
      id: 'table-switch-compact-24',
      title: 'table-switch-compact-24',
      render: () => <CryptocurrencyDemo part="table-switch" kind="compact" size={24} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-switch" kind="compact" size={24} />'),
    },
    {
      id: 'table-switch-detailed-24',
      title: 'table-switch-detailed-24',
      render: () => <CryptocurrencyDemo part="table-switch" kind="detailed" size={24} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-switch" kind="detailed" size={24} />'),
    },
    {
      id: 'table-switch-compact-28',
      title: 'table-switch-compact-28',
      render: () => <CryptocurrencyDemo part="table-switch" kind="compact" size={28} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-switch" kind="compact" size={28} />'),
    },
    {
      id: 'table-switch-detailed-28',
      title: 'table-switch-detailed-28',
      render: () => <CryptocurrencyDemo part="table-switch" kind="detailed" size={28} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="table-switch" kind="detailed" size={28} />'),
    },
    {
      id: 'swap-input-selling-default',
      title: 'swap-input-selling-default',
      render: () => <CryptocurrencyDemo part="swap-input" kind="selling" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-input" kind="selling" state="default" />'),
    },
    {
      id: 'swap-input-receive-default',
      title: 'swap-input-receive-default',
      render: () => <CryptocurrencyDemo part="swap-input" kind="receive" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-input" kind="receive" state="default" />'),
    },
    {
      id: 'swap-input-selling-hover',
      title: 'swap-input-selling-hover',
      render: () => <CryptocurrencyDemo part="swap-input" kind="selling" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-input" kind="selling" state="hover" />'),
    },
    {
      id: 'swap-input-receive-hover',
      title: 'swap-input-receive-hover',
      render: () => <CryptocurrencyDemo part="swap-input" kind="receive" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-input" kind="receive" state="hover" />'),
    },
    {
      id: 'swap-input-selling-active',
      title: 'swap-input-selling-active',
      render: () => <CryptocurrencyDemo part="swap-input" kind="selling" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-input" kind="selling" state="active" />'),
    },
    {
      id: 'swap-input-receive-active',
      title: 'swap-input-receive-active',
      render: () => <CryptocurrencyDemo part="swap-input" kind="receive" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-input" kind="receive" state="active" />'),
    },
    {
      id: 'swap-input-selling-filled',
      title: 'swap-input-selling-filled',
      render: () => <CryptocurrencyDemo part="swap-input" kind="selling" state="filled" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-input" kind="selling" state="filled" />'),
    },
    {
      id: 'swap-input-receive-filled',
      title: 'swap-input-receive-filled',
      render: () => <CryptocurrencyDemo part="swap-input" kind="receive" state="filled" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-input" kind="receive" state="filled" />'),
    },
    {
      id: 'swap-input-selling-disabled',
      title: 'swap-input-selling-disabled',
      render: () => <CryptocurrencyDemo part="swap-input" kind="selling" state="disabled" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-input" kind="selling" state="disabled" />'),
    },
    {
      id: 'swap-input-receive-disabled',
      title: 'swap-input-receive-disabled',
      render: () => <CryptocurrencyDemo part="swap-input" kind="receive" state="disabled" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-input" kind="receive" state="disabled" />'),
    },
    {
      id: 'swap-input-selling-error',
      title: 'swap-input-selling-error',
      render: () => <CryptocurrencyDemo part="swap-input" kind="selling" state="error" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-input" kind="selling" state="error" />'),
    },
    {
      id: 'swap-input-receive-error',
      title: 'swap-input-receive-error',
      render: () => <CryptocurrencyDemo part="swap-input" kind="receive" state="error" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-input" kind="receive" state="error" />'),
    },
    {
      id: 'swap-1',
      title: 'swap-1',
      render: () => <CryptocurrencyDemo part="swap" step={1} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap" step={1} />'),
    },
    {
      id: 'swap-2',
      title: 'swap-2',
      render: () => <CryptocurrencyDemo part="swap" step={2} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap" step={2} />'),
    },
    {
      id: 'swap-3',
      title: 'swap-3',
      render: () => <CryptocurrencyDemo part="swap" step={3} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap" step={3} />'),
    },
    {
      id: 'search-modal-default',
      title: 'search-modal-default',
      render: () => <CryptocurrencyDemo part="search-modal" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="search-modal" state="default" />'),
    },
    {
      id: 'search-modal-searching',
      title: 'search-modal-searching',
      render: () => <CryptocurrencyDemo part="search-modal" state="searching" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="search-modal" state="searching" />'),
    },
    {
      id: 'search-modal-empty',
      title: 'search-modal-empty',
      render: () => <CryptocurrencyDemo part="search-modal" state="empty" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="search-modal" state="empty" />'),
    },
    {
      id: 'search-input-default',
      title: 'search-input-default',
      render: () => <CryptocurrencyDemo part="search-input" state="default" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="search-input" state="default" />'),
    },
    {
      id: 'search-input-hover',
      title: 'search-input-hover',
      render: () => <CryptocurrencyDemo part="search-input" state="hover" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="search-input" state="hover" />'),
    },
    {
      id: 'search-input-active',
      title: 'search-input-active',
      render: () => <CryptocurrencyDemo part="search-input" state="active" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="search-input" state="active" />'),
    },
    {
      id: 'navigation-false',
      title: 'navigation-false',
      render: () => <CryptocurrencyDemo part="navigation" profile={false} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation" profile={false} />'),
    },
    {
      id: 'navigation-true',
      title: 'navigation-true',
      render: () => <CryptocurrencyDemo part="navigation" profile={true} />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="navigation" profile={true} />'),
    },
    {
      id: 'social-button-phantom-default-true',
      title: 'social-button-phantom-default-true',
      render: () => <CryptocurrencyDemo part="social-button" kind="phantom" state="default" onlyIcon={true} />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="social-button" kind="phantom" state="default" onlyIcon={true} />',
      ),
    },
    {
      id: 'social-button-walletconnect-default-true',
      title: 'social-button-walletconnect-default-true',
      render: () => <CryptocurrencyDemo part="social-button" kind="walletconnect" state="default" onlyIcon={true} />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="social-button" kind="walletconnect" state="default" onlyIcon={true} />',
      ),
    },
    {
      id: 'social-button-metamask-default-true',
      title: 'social-button-metamask-default-true',
      render: () => <CryptocurrencyDemo part="social-button" kind="metamask" state="default" onlyIcon={true} />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="social-button" kind="metamask" state="default" onlyIcon={true} />',
      ),
    },
    {
      id: 'social-button-phantom-hover-true',
      title: 'social-button-phantom-hover-true',
      render: () => <CryptocurrencyDemo part="social-button" kind="phantom" state="hover" onlyIcon={true} />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="social-button" kind="phantom" state="hover" onlyIcon={true} />',
      ),
    },
    {
      id: 'social-button-walletconnect-hover-true',
      title: 'social-button-walletconnect-hover-true',
      render: () => <CryptocurrencyDemo part="social-button" kind="walletconnect" state="hover" onlyIcon={true} />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="social-button" kind="walletconnect" state="hover" onlyIcon={true} />',
      ),
    },
    {
      id: 'social-button-metamask-hover-true',
      title: 'social-button-metamask-hover-true',
      render: () => <CryptocurrencyDemo part="social-button" kind="metamask" state="hover" onlyIcon={true} />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="social-button" kind="metamask" state="hover" onlyIcon={true} />',
      ),
    },
    {
      id: 'social-button-phantom-default-false',
      title: 'social-button-phantom-default-false',
      render: () => <CryptocurrencyDemo part="social-button" kind="phantom" state="default" onlyIcon={false} />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="social-button" kind="phantom" state="default" onlyIcon={false} />',
      ),
    },
    {
      id: 'social-button-phantom-hover-false',
      title: 'social-button-phantom-hover-false',
      render: () => <CryptocurrencyDemo part="social-button" kind="phantom" state="hover" onlyIcon={false} />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="social-button" kind="phantom" state="hover" onlyIcon={false} />',
      ),
    },
    {
      id: 'social-button-walletconnect-default-false',
      title: 'social-button-walletconnect-default-false',
      render: () => <CryptocurrencyDemo part="social-button" kind="walletconnect" state="default" onlyIcon={false} />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="social-button" kind="walletconnect" state="default" onlyIcon={false} />',
      ),
    },
    {
      id: 'social-button-walletconnect-hover-false',
      title: 'social-button-walletconnect-hover-false',
      render: () => <CryptocurrencyDemo part="social-button" kind="walletconnect" state="hover" onlyIcon={false} />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="social-button" kind="walletconnect" state="hover" onlyIcon={false} />',
      ),
    },
    {
      id: 'social-button-metamask-default-false',
      title: 'social-button-metamask-default-false',
      render: () => <CryptocurrencyDemo part="social-button" kind="metamask" state="default" onlyIcon={false} />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="social-button" kind="metamask" state="default" onlyIcon={false} />',
      ),
    },
    {
      id: 'social-button-metamask-hover-false',
      title: 'social-button-metamask-hover-false',
      render: () => <CryptocurrencyDemo part="social-button" kind="metamask" state="hover" onlyIcon={false} />,
      code: cryptocurrencyPatternCode(
        '<CryptocurrencyDemo part="social-button" kind="metamask" state="hover" onlyIcon={false} />',
      ),
    },
    {
      id: 'menu-dropdown',
      title: 'menu-dropdown',
      render: () => <CryptocurrencyDemo part="menu-dropdown" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="menu-dropdown" />'),
    },
    {
      id: 'favorites-dropdown',
      title: 'favorites-dropdown',
      render: () => <CryptocurrencyDemo part="favorites-dropdown" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="favorites-dropdown" />'),
    },
    {
      id: 'profile-dropdown',
      title: 'profile-dropdown',
      render: () => <CryptocurrencyDemo part="profile-dropdown" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="profile-dropdown" />'),
    },
    {
      id: 'wallet-dropdown',
      title: 'wallet-dropdown',
      render: () => <CryptocurrencyDemo part="wallet-dropdown" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="wallet-dropdown" />'),
    },
    {
      id: 'swap-token-dropdown',
      title: 'swap-token-dropdown',
      render: () => <CryptocurrencyDemo part="swap-token-dropdown" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="swap-token-dropdown" />'),
    },
    {
      id: 'notifications-dropdown',
      title: 'notifications-dropdown',
      render: () => <CryptocurrencyDemo part="notifications-dropdown" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="notifications-dropdown" />'),
    },
    {
      id: 'connect-wallet',
      title: 'connect-wallet',
      render: () => <CryptocurrencyDemo part="connect-wallet" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="connect-wallet" />'),
    },
    {
      id: 'banner',
      title: 'banner',
      render: () => <CryptocurrencyDemo part="banner" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="banner" />'),
    },
    {
      id: 'filter-type',
      title: 'filter-type',
      render: () => <CryptocurrencyDemo part="filter-type" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="filter-type" />'),
    },
    {
      id: 'filter-date',
      title: 'filter-date',
      render: () => <CryptocurrencyDemo part="filter-date" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="filter-date" />'),
    },
    {
      id: 'filter-status',
      title: 'filter-status',
      render: () => <CryptocurrencyDemo part="filter-status" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="filter-status" />'),
    },
    {
      id: 'filter-token',
      title: 'filter-token',
      render: () => <CryptocurrencyDemo part="filter-token" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="filter-token" />'),
    },
    {
      id: 'mobile-navigation',
      title: 'mobile-navigation',
      render: () => <CryptocurrencyDemo part="mobile-navigation" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="mobile-navigation" />'),
    },
    {
      id: 'mobile-bottom-navigation',
      title: 'mobile-bottom-navigation',
      render: () => <CryptocurrencyDemo part="mobile-bottom-navigation" />,
      code: cryptocurrencyPatternCode('<CryptocurrencyDemo part="mobile-bottom-navigation" />'),
    },
  ],
}
export const entries: GalleryEntry[] = [
  cryptocurrencyEntry,
  pageEntry,
  sectionHeaderEntry,
  sectionPageEntry,
  formHeaderEntry,
  formFooterEntry,
  actionsDropdownEntry,
]
