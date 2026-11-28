import * as React from 'react'
import { Section } from '@open-mercato/ui/blocks/section'
import { sectionFixtures } from '@open-mercato/ui/blocks/section/fixtures'
import { sectionPropsSchema } from '@open-mercato/ui/blocks/contracts/section'
import { KeyValue } from '@open-mercato/ui/blocks/key-value'
import type { KeyValueItem } from '@open-mercato/ui/blocks/contracts/key-value'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import type { GalleryEntry } from '../types'

const COMPANY_FACTS: KeyValueItem[] = [
  { key: 'legal-name', label: 'Legal name', value: 'Harbour Line Trading' },
  { key: 'tax-number', label: 'Tax number', value: 'PL 583 204 17 65' },
  { key: 'segment', label: 'Segment', value: 'Wholesale' },
  { key: 'owner', label: 'Account owner', value: 'Morgan Lee' },
  { key: 'customer-since', label: 'Customer since', value: '2023-04-18', format: 'date' },
  { key: 'credit-limit', label: 'Credit limit', value: '25 000 EUR' },
]

const BILLING_FACTS: KeyValueItem[] = [
  { key: 'invoice-name', label: 'Name on invoice', value: 'Harbour Line Trading' },
  { key: 'address', label: 'Address', value: '12 Harbour Street, 80-001 Gdansk' },
  { key: 'invoice-email', label: 'Invoices sent to', value: 'accounts@harbourline.example' },
]

const PAYMENT_FACTS: KeyValueItem[] = [
  { key: 'terms', label: 'Payment terms', value: '14 days' },
  { key: 'currency', label: 'Currency', value: 'EUR' },
  { key: 'method', label: 'Method', value: 'Bank transfer' },
]

const SHIPPING_FACTS: KeyValueItem[] = [
  { key: 'free-above', label: 'Free shipping above', value: '400 EUR' },
  { key: 'carriers', label: 'Carriers', value: 'Road freight, parcel' },
  { key: 'cut-off', label: 'Same day cut-off', value: '14:00' },
]

const ADVANCED_FACTS: KeyValueItem[] = [
  { key: 'rounding', label: 'Rounding', value: 'Per line' },
  { key: 'numbering', label: 'Numbering', value: 'Resets every year' },
]

const LOCATION_FACTS: KeyValueItem[] = [
  { key: 'main', label: 'Main warehouse', value: '12 Harbour Street, Gdansk' },
  { key: 'returns', label: 'Returns', value: '4 Mill Lane, Gdynia' },
]

const CONTACTS = [
  { name: 'Morgan Lee', role: 'Purchasing lead', email: 'morgan.lee@harbourline.example' },
  { name: 'Alex Novak', role: 'Finance', email: 'alex.novak@harbourline.example' },
  { name: 'Sam Rivera', role: 'Logistics', email: 'sam.rivera@harbourline.example' },
  { name: 'Kim Sato', role: 'Customer support', email: 'kim.sato@harbourline.example' },
]

type MemberStatus = 'active' | 'invited'

const TEAM_MEMBERS: Array<{ name: string; role: string; status: MemberStatus; orders: number }> = [
  { name: 'Morgan Lee', role: 'Owner', status: 'active', orders: 142 },
  { name: 'Alex Novak', role: 'Editor', status: 'active', orders: 87 },
  { name: 'Sam Rivera', role: 'Editor', status: 'active', orders: 31 },
  { name: 'Kim Sato', role: 'Viewer', status: 'invited', orders: 0 },
]

const MEMBER_STATUS: Record<MemberStatus, { label: string; variant: 'success' | 'neutral' }> = {
  active: { label: 'Active', variant: 'success' },
  invited: { label: 'Invited', variant: 'neutral' },
}

const REMINDER_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
]

function frameClass(width: string): string {
  return `w-full ${width} rounded-card border border-border bg-card p-4`
}

function ContactList() {
  return (
    <ul className="flex flex-col">
      {CONTACTS.map((contact) => (
        <li
          key={contact.email}
          className="flex min-h-10 flex-wrap items-center gap-x-4 border-t border-border py-2 first:border-t-0"
        >
          <span className="flex min-w-0 flex-1 basis-40 flex-wrap items-baseline gap-x-2">
            <span className="text-sm text-foreground">{contact.name}</span>
            <span className="text-sm text-muted-foreground">{contact.role}</span>
          </span>
          <span className="min-w-0 truncate text-sm text-muted-foreground">{contact.email}</span>
        </li>
      ))}
    </ul>
  )
}

type SettingFieldProps = { id: string; label: string; hint: string; children: React.ReactNode }

function SettingField({ id, label, hint, children }: SettingFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-foreground">
        {label}
      </label>
      {children}
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {hint}
      </p>
    </div>
  )
}

type SettingSwitchProps = {
  id: string
  label: string
  hint: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

function SettingSwitch({ id, label, hint, checked, onCheckedChange }: SettingSwitchProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="cursor-pointer text-sm text-foreground">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-describedby={`${id}-hint`} />
    </div>
  )
}

type NotificationDraft = { sender: string; reminders: string; notifyOwner: boolean }

const SAVED_NOTIFICATIONS: NotificationDraft = { sender: 'Harbour Line orders', reminders: 'weekly', notifyOwner: true }

function SettingsSplitExample() {
  const fieldId = React.useId()
  const [saved, setSaved] = React.useState(SAVED_NOTIFICATIONS)
  const [draft, setDraft] = React.useState(SAVED_NOTIFICATIONS)
  const dirty = draft.sender !== saved.sender || draft.reminders !== saved.reminders || draft.notifyOwner !== saved.notifyOwner
  return (
    <Section
      {...sectionFixtures.settingsSplit}
      className="w-full max-w-4xl"
      footerNote={dirty ? 'You have unsaved changes.' : sectionFixtures.settingsSplit.footerNote}
      footer={
        <>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-10 font-normal disabled:bg-transparent sm:h-8"
            disabled={!dirty}
            onClick={() => setDraft(saved)}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" className="h-10 font-normal sm:h-8" disabled={!dirty} onClick={() => setSaved(draft)}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex max-w-md flex-col gap-5">
        <SettingField id={`${fieldId}-sender`} label="Sender name" hint="Shown as the sender of every order email.">
          <Input
            id={`${fieldId}-sender`}
            value={draft.sender}
            aria-describedby={`${fieldId}-sender-hint`}
            onChange={(event) => setDraft((current) => ({ ...current, sender: event.target.value }))}
          />
        </SettingField>
        <SettingField
          id={`${fieldId}-reminders`}
          label="Payment reminders"
          hint="Sent while an invoice for the order stays unpaid."
        >
          <Select
            value={draft.reminders}
            onValueChange={(reminders) => setDraft((current) => ({ ...current, reminders }))}
          >
            <SelectTrigger id={`${fieldId}-reminders`} aria-describedby={`${fieldId}-reminders-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REMINDER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingField>
        <SettingSwitch
          id={`${fieldId}-owner`}
          label="Tell the account owner"
          hint="The owner gets a copy when an order is delayed or cancelled."
          checked={draft.notifyOwner}
          onCheckedChange={(notifyOwner) => setDraft((current) => ({ ...current, notifyOwner }))}
        />
      </div>
    </Section>
  )
}

function SettingsPageExample() {
  const fieldId = React.useId()
  const [emailEnabled, setEmailEnabled] = React.useState(true)
  const [digest, setDigest] = React.useState(true)
  const [mentions, setMentions] = React.useState(false)
  const [language, setLanguage] = React.useState('en')
  const [displayName, setDisplayName] = React.useState('Morgan Lee')
  return (
    <div className={frameClass('max-w-4xl')}>
      <Section title="Profile" description="How your name appears to the rest of the team." variant="plain" layout="split">
        <div className="flex max-w-md flex-col gap-5">
          <SettingField id={`${fieldId}-name`} label="Display name" hint="Shown next to your comments and changes.">
            <Input
              id={`${fieldId}-name`}
              value={displayName}
              aria-describedby={`${fieldId}-name-hint`}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </SettingField>
          <SettingField id={`${fieldId}-language`} label="Language" hint="Used for the interface and for emails sent to you.">
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id={`${fieldId}-language`} aria-describedby={`${fieldId}-language-hint`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="pl">Polski</SelectItem>
                <SelectItem value="de">Deutsch</SelectItem>
              </SelectContent>
            </Select>
          </SettingField>
        </div>
      </Section>
      <Section
        title="Email notifications"
        description="Turn all email off here, or choose what is worth an email."
        variant="plain"
        layout="split"
        headerTrailing={
          <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} aria-label="Email notifications" />
        }
      >
        <div className="flex max-w-md flex-col gap-5">
          <SettingSwitch
            id={`${fieldId}-digest`}
            label="Daily summary"
            hint="One email each morning with yesterday's orders."
            checked={emailEnabled && digest}
            onCheckedChange={setDigest}
          />
          <SettingSwitch
            id={`${fieldId}-mentions`}
            label="Mentions"
            hint="An email whenever someone mentions you in a comment."
            checked={emailEnabled && mentions}
            onCheckedChange={setMentions}
          />
        </div>
      </Section>
    </div>
  )
}

function PlainStackExample() {
  return (
    <div className={frameClass('max-w-2xl')}>
      <Section {...sectionFixtures.plain}>
        <KeyValue items={BILLING_FACTS} />
      </Section>
      <Section {...sectionFixtures.plainSecond}>
        <KeyValue items={PAYMENT_FACTS} />
      </Section>
    </div>
  )
}

function FlushTableExample() {
  return (
    <Section {...sectionFixtures.flush} className="w-full max-w-2xl">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Orders</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {TEAM_MEMBERS.map((member) => (
              <TableRow key={member.name}>
                <TableCell className="whitespace-nowrap">{member.name}</TableCell>
                <TableCell className="text-muted-foreground">{member.role}</TableCell>
                <TableCell>
                  <StatusBadge variant={MEMBER_STATUS[member.status].variant} dot>
                    {MEMBER_STATUS[member.status].label}
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{member.orders}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  )
}

function CollapsibleExample() {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <Section {...sectionFixtures.collapsibleExpanded}>
        <KeyValue items={SHIPPING_FACTS} />
      </Section>
      <Section {...sectionFixtures.collapsible}>
        <KeyValue items={ADVANCED_FACTS} />
      </Section>
    </div>
  )
}

function ErrorToneExample() {
  return (
    <Section {...sectionFixtures.errorTone} className="w-full max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground">
          4 contacts and 2 delivery addresses will be removed. This cannot be undone.
        </p>
        <Button type="button" size="sm" variant="destructive" className="h-10 font-normal sm:h-8">
          Delete company
        </Button>
      </div>
    </Section>
  )
}

const sectionCode = (props: string, body = '  <CompanyFacts />') => `import { Section } from '@open-mercato/ui/blocks/section'

<Section
${props}
>
${body}
</Section>`

export const sectionEntry: GalleryEntry = {
  id: 'section',
  title: 'Section',
  importPath: '@open-mercato/ui/blocks/section',
  contract: {
    schema: sectionPropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/section',
    implementationPath: '@open-mercato/ui/blocks/section/Section',
  },
  descriptionKey: 'design_system.entries.section.description',
  keywords: ['card', 'panel', 'titled section', 'section card', 'settings section', 'detail section', 'collapsible', 'frame', 'split layout'],
  usage: {
    do: [
      'Use the card variant as the one frame of a detail or settings screen; everything inside it stays unframed',
      'Stack plain sections directly under each other inside a surface that is already framed; they draw the divider and the spacing themselves',
      'Use layout="split" on settings screens: the title and description explain, the controls sit in the wider column',
      'Pass padding="none" when the body is a table or a list, so it sits flush with the frame under a hairline',
      'Put a section-level Save and Cancel into the footer and a short status into footerNote',
      'Give a collapsible section a summary, so it still tells what is inside when closed',
      'Drive loading, error and empty through status so the header stays in place while the body changes',
    ],
    dont: [
      'Do not place a card section inside another card, a bordered table container or a dialog; use the plain variant there',
      'Do not add gaps or dividers between stacked plain sections; the spacing would double',
      'Do not give header actions without an icon when there are several; only the first one shows its label',
      'Do not run destructive actions without a confirmation in onAction',
      'Do not repeat the title or the count in the description or the summary',
      'Do not use the error tone for a hint or a reminder; it marks a destructive or failed section',
    ],
  },
  accessibility: [
    'The block renders a section element labelled by its heading, so it is exposed as a named region',
    'A collapsible section puts a native button inside the heading with aria-expanded and aria-controls; the whole header row is its click target, and Enter and Space toggle it',
    'Collapsed content stays in the page but is hidden from sight, the keyboard and assistive technology',
    'The count is announced with its unit, and the more menu names the section it belongs to',
    'Icon-only actions carry their label as the accessible name and show it in a tooltip on hover and focus',
    'A disabled action with a reason stays focusable and is described by that reason',
    'Controls are 40 px tall below the sm breakpoint and 32 px above it, with a visible focus ring',
    'While loading the region is marked busy and the skeleton carries a text alternative',
  ],
  faq: [
    {
      question: 'Why do the header actions disappear on a phone?',
      answer:
        'Below the sm breakpoint every action moves into the more menu so the title keeps the full width. Nothing is removed.',
    },
    {
      question: 'Why is there no line above my plain section?',
      answer:
        'A plain section draws the divider and 24 px of space only when it directly follows another plain section. The first one in a group gets neither.',
    },
    {
      question: 'Why does the split layout stay stacked in my drawer?',
      answer:
        'The split follows the width of the section itself, not of the window. Below about 670 px of section width the header returns above the body.',
    },
    {
      question: 'Why does the table in my section have a double border?',
      answer:
        'The table brings its own bordered container. Render the table without a frame and set padding="none" on the section.',
    },
  ],
  tokens: [
    '--card',
    '--card-foreground',
    '--border',
    '--radius-card',
    '--muted',
    '--muted-foreground',
    '--accent',
    '--status-error-bg',
    '--status-error-icon',
  ],
  variants: [
    {
      id: 'default',
      title: 'Record section with facts and actions',
      description: 'The first action shows its label, the others are icons with a tooltip.',
      render: () => (
        <Section {...sectionFixtures.default} className="w-full max-w-4xl">
          <KeyValue items={COMPANY_FACTS} columns={2} />
        </Section>
      ),
      code: sectionCode(`  title="Company details"
  description="Used on quotes, orders and invoices."
  icon="building"
  actions={[
    { key: 'edit', label: 'Edit', icon: 'pencil-line' },
    { key: 'copy', label: 'Copy details', icon: 'copy' },
    { key: 'history', label: 'View history', icon: 'clock', href: historyHref },
  ]}
  onAction={handleAction}`, '  <KeyValue items={companyFacts} columns={2} />'),
    },
    {
      id: 'overflowing-actions',
      title: 'With count and overflowing actions',
      description: 'Actions past maxVisibleActions move into the more menu. A destructive action always lives in the menu.',
      render: () => (
        <Section {...sectionFixtures.overflowingActions} className="w-full max-w-2xl">
          <ContactList />
        </Section>
      ),
      code: sectionCode(
        `  title="Contacts"
  count={contacts.length}
  icon="users"
  maxVisibleActions={3}
  actions={[
    { key: 'add', label: 'Add contact', icon: 'user-plus' },
    { key: 'import', label: 'Import', icon: 'file-spreadsheet' },
    { key: 'export', label: 'Export', icon: 'download' },
    { key: 'history', label: 'View history', icon: 'clock', href: historyHref },
    { key: 'remove-all', label: 'Remove all', icon: 'trash-2', tone: 'destructive' },
  ]}
  onAction={handleAction}`,
        '  <ContactList contacts={contacts} />',
      ),
    },
    {
      id: 'settings-split',
      title: 'Settings, split layout',
      description: 'Title and description on the left, controls on the right, Save in the footer. Change a value to enable Save.',
      render: () => <SettingsSplitExample />,
      code: sectionCode(
        `  title="Order notifications"
  description="Who hears about an order and how often they are reminded."
  layout="split"
  footerNote={dirty ? unsavedNote : appliesNote}
  footer={
    <>
      <Button variant="ghost" size="sm" disabled={!dirty} onClick={reset}>{cancelLabel}</Button>
      <Button size="sm" disabled={!dirty} onClick={save}>{saveLabel}</Button>
    </>
  }`,
        '  <NotificationFields draft={draft} onChange={setDraft} />',
      ),
    },
    {
      id: 'settings-page',
      title: 'Settings page from plain sections',
      description: 'Plain split sections stacked in one frame. The switch in the header sits in headerTrailing.',
      render: () => <SettingsPageExample />,
      code: `import { Section } from '@open-mercato/ui/blocks/section'

<div className="rounded-card border border-border bg-card p-4">
  <Section title="Profile" description={profileHint} variant="plain" layout="split">
    <ProfileFields />
  </Section>
  <Section
    title="Email notifications"
    description={emailHint}
    variant="plain"
    layout="split"
    headerTrailing={<Switch checked={enabled} onCheckedChange={setEnabled} aria-label={emailLabel} />}
  >
    <EmailFields />
  </Section>
</div>`,
    },
    {
      id: 'plain-stacked',
      title: 'Plain, two stacked',
      description: 'Inside one frame the sections draw no frame of their own and keep 24 px above and below the divider between them.',
      render: () => <PlainStackExample />,
      code: `import { Section } from '@open-mercato/ui/blocks/section'

<div className="rounded-card border border-border bg-card p-4">
  <Section
    title="Billing details"
    description="Shown on invoices."
    variant="plain"
    actions={[{ key: 'edit', label: 'Edit', icon: 'pencil-line' }]}
    onAction={handleAction}
  >
    <KeyValue items={billingFacts} />
  </Section>
  <Section
    title="Payment"
    description="Applied to new orders."
    variant="plain"
    actions={[{ key: 'edit', label: 'Edit', icon: 'pencil-line' }]}
    onAction={handleAction}
  >
    <KeyValue items={paymentFacts} />
  </Section>
</div>`,
    },
    {
      id: 'flush-table',
      title: 'Flush body with a table',
      description: 'With padding none the table reaches the frame under a hairline, and the section stays the only frame.',
      render: () => <FlushTableExample />,
      code: sectionCode(
        `  title="Team members"
  count={members.length}
  padding="none"
  actions={[{ key: 'invite', label: 'Invite', icon: 'user-plus' }]}
  onAction={handleAction}`,
        '  <MembersTable members={members} />',
      ),
    },
    {
      id: 'collapsible',
      title: 'Collapsible',
      description: 'The whole header row toggles. A closed section shows its summary; open the second one to compare.',
      render: () => <CollapsibleExample />,
      code: sectionCode(
        `  title="Advanced settings"
  description="Rarely changed options for rounding and numbering."
  icon="sliders-horizontal"
  collapsible
  defaultCollapsed
  summary="Rounding per line, numbers reset yearly"`,
        '  <AdvancedSettings />',
      ),
    },
    {
      id: 'error-tone',
      title: 'Error tone',
      description: 'A tinted header strip and an alert icon mark the section; the frame keeps its neutral border.',
      render: () => <ErrorToneExample />,
      code: sectionCode(
        `  title="Delete this company"
  description="Removes the company with its contacts and addresses. Orders and invoices are kept."
  tone="error"`,
        '  <DeleteCompany />',
      ),
    },
    {
      id: 'loading',
      title: 'Loading',
      render: () => <Section {...sectionFixtures.loading} className="w-full max-w-2xl" />,
      code: sectionCode(
        `  title="Recent orders"
  icon="package"
  status="loading"
  actions={[{ key: 'create', label: 'Create order', icon: 'plus-square' }]}
  onAction={handleAction}`,
        '  <RecentOrders />',
      ),
    },
    {
      id: 'error',
      title: 'Error with retry',
      render: () => <Section {...sectionFixtures.error} className="w-full max-w-2xl" />,
      code: sectionCode(
        `  title="Recent orders"
  icon="package"
  status="error"
  errorMessage={loadError}
  onRetry={reload}`,
        '  <RecentOrders />',
      ),
    },
    {
      id: 'empty',
      title: 'Empty',
      description: 'The first header action is repeated under the invitation.',
      render: () => <Section {...sectionFixtures.empty} className="w-full max-w-2xl" />,
      code: sectionCode(
        `  title="Recent orders"
  icon="package"
  status="empty"
  emptyTitle="No orders yet"
  emptyDescription="Orders placed by this company will be listed here."
  actions={[{ key: 'create', label: 'Create order', icon: 'plus-square' }]}
  onAction={handleAction}`,
        '  <RecentOrders />',
      ),
    },
    {
      id: 'narrow',
      title: 'Narrow width',
      description: 'A long title wraps and the description follows it. Below the sm breakpoint every action moves into the more menu.',
      render: () => (
        <Section {...sectionFixtures.narrow} className="w-full max-w-sm">
          <KeyValue items={LOCATION_FACTS} />
        </Section>
      ),
      code: sectionCode(
        `  title="Warehouse locations with same day delivery"
  description="Locations that can ship an order on the day it is placed."
  count={12}
  actions={[
    { key: 'add', label: 'Add location', icon: 'plus-square' },
    { key: 'import', label: 'Import', icon: 'file-spreadsheet' },
    { key: 'remove-all', label: 'Remove all', icon: 'trash-2', tone: 'destructive' },
  ]}
  onAction={handleAction}`,
        '  <LocationList />',
      ),
    },
  ],
}
