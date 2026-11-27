import * as React from 'react'
import { FormSaveBar, FORM_SAVE_BAR_FLOATING_SPACER_CLASS } from '@open-mercato/ui/blocks/form-save-bar'
import { formSaveBarFixtures } from '@open-mercato/ui/blocks/form-save-bar/fixtures'
import { formSaveBarPropsSchema, type FormSaveState } from '@open-mercato/ui/blocks/contracts/form-save-bar'
import { Input } from '@open-mercato/ui/primitives/input'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import type { GalleryEntry } from '../types'

type CompanyDraft = { name: string; city: string; contact: string; phone: string; notes: string }

const SAVED_COMPANY: CompanyDraft = {
  name: 'Northwind Supplies',
  city: 'Gdansk',
  contact: 'Morgan Lee',
  phone: '+48 600 100 200',
  notes: 'Prefers deliveries before noon',
}

const COMPANY_FIELDS: Array<{ key: keyof CompanyDraft; label: string }> = [
  { key: 'name', label: 'Company name' },
  { key: 'city', label: 'City' },
  { key: 'contact', label: 'Contact person' },
  { key: 'phone', label: 'Phone' },
  { key: 'notes', label: 'Delivery notes' },
]

const SAVE_DELAY_MS = 1200
const SAVED_CONFIRMATION_MS = 2500

function useCompanyDraft(initial: CompanyDraft) {
  const [saved, setSaved] = React.useState<CompanyDraft>(SAVED_COMPANY)
  const [draft, setDraft] = React.useState<CompanyDraft>(initial)
  const [savedAt, setSavedAt] = React.useState<string | undefined>(undefined)
  const [confirming, setConfirming] = React.useState(false)
  const timers = React.useRef<Array<ReturnType<typeof setTimeout>>>([])

  React.useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => clearTimeout(timer))
  }, [])

  const dirty = COMPANY_FIELDS.some((field) => draft[field.key] !== saved[field.key])
  const saveState: FormSaveState = dirty ? 'dirty' : confirming ? 'saved' : 'idle'

  const save = () =>
    new Promise<void>((resolve) => {
      timers.current.push(
        setTimeout(() => {
          setSaved(draft)
          setSavedAt(new Date().toISOString())
          setConfirming(true)
          timers.current.push(setTimeout(() => setConfirming(false), SAVED_CONFIRMATION_MS))
          resolve()
        }, SAVE_DELAY_MS),
      )
    })

  const change = (key: keyof CompanyDraft, value: string) => {
    setConfirming(false)
    setDraft((current) => ({ ...current, [key]: value }))
  }

  return { draft, saveState, savedAt, save, change, reset: () => setDraft(saved) }
}

function CompanyFields({
  idPrefix,
  draft,
  fields,
  onChange,
}: {
  idPrefix: string
  draft: CompanyDraft
  fields: Array<{ key: keyof CompanyDraft; label: string }>
  onChange: (key: keyof CompanyDraft, value: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${idPrefix}-${field.key}`}>{field.label}</FieldLabel>
          <Input
            id={`${idPrefix}-${field.key}`}
            value={draft[field.key]}
            onChange={(event) => onChange(field.key, event.target.value)}
          />
        </div>
      ))}
    </div>
  )
}

function InteractiveExample() {
  const idPrefix = React.useId()
  const form = useCompanyDraft(SAVED_COMPANY)
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <CompanyFields idPrefix={idPrefix} draft={form.draft} fields={COMPANY_FIELDS.slice(0, 2)} onChange={form.change} />
      <div className="min-h-14">
        <FormSaveBar
          placement="inline"
          saveState={form.saveState}
          savedAt={form.savedAt}
          onSave={form.save}
          onReset={form.reset}
        />
      </div>
    </div>
  )
}

function ContainerExample() {
  const idPrefix = React.useId()
  const form = useCompanyDraft({ ...SAVED_COMPANY, city: 'Gdynia' })
  return (
    <div className="h-72 w-full max-w-xl overflow-y-auto rounded-card border border-border bg-card">
      <div className="p-4">
        <CompanyFields idPrefix={idPrefix} draft={form.draft} fields={COMPANY_FIELDS} onChange={form.change} />
      </div>
      <FormSaveBar
        placement="container"
        saveState={form.saveState}
        savedAt={form.savedAt}
        onSave={form.save}
        onReset={form.reset}
      />
    </div>
  )
}

function FloatingExample() {
  const idPrefix = React.useId()
  const form = useCompanyDraft({ ...SAVED_COMPANY, name: 'Northwind Supplies Ltd' })
  return (
    <div className="h-80 w-full transform-gpu overflow-hidden rounded-card border border-border bg-background">
      <div className={`h-full overflow-y-auto p-4 ${FORM_SAVE_BAR_FLOATING_SPACER_CLASS}`}>
        <div className="mx-auto max-w-xl">
          <CompanyFields idPrefix={idPrefix} draft={form.draft} fields={COMPANY_FIELDS} onChange={form.change} />
        </div>
      </div>
      <FormSaveBar saveState={form.saveState} savedAt={form.savedAt} onSave={form.save} onReset={form.reset} />
    </div>
  )
}

const formSaveBarCode = (props: string) => `import { FormSaveBar } from '@open-mercato/ui/blocks/form-save-bar'

<FormSaveBar
${props}
/>`

export const formSaveBarEntry: GalleryEntry = {
  id: 'form-save-bar',
  title: 'FormSaveBar',
  importPath: '@open-mercato/ui/blocks/form-save-bar',
  contract: {
    schema: formSaveBarPropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/form-save-bar',
    implementationPath: '@open-mercato/ui/blocks/form-save-bar/FormSaveBar',
  },
  descriptionKey: 'design_system.entries.form-save-bar.description',
  keywords: ['unsaved changes', 'dirty', 'save', 'reset', 'sticky footer', 'form actions'],
  usage: {
    do: [
      'Own the form, the dirty check and the save call in the host; pass the result as saveState',
      'Return to idle a moment after saved so the bar goes away again',
      'Use the bar as the only Save on the page; remove the Save button from the header and footer',
      'Add FORM_SAVE_BAR_FLOATING_SPACER_CLASS to the scrolling page container in the floating placement so the last field is not covered',
      'Use placement="container" inside dialogs, sheets and side panels and render the bar as the last child of the scrolling element; it takes its own space there, so no extra padding is needed',
      'Pass formId to submit a form natively, or onSave to save from a handler; a promise returned from onSave shows the saving state until it settles',
      'Pass getReturnFocusTarget when focus should land somewhere specific after the bar hides, for example the page heading; without it focus goes to the form named by formId',
    ],
    dont: [
      'Do not pass both formId and onSave expecting two saves; with formId the button only submits the form',
      'Do not rely on the bar for navigation guards, keyboard shortcuts or conflict handling; these stay in the host',
      'Do not put Cancel or navigation into actions; the more menu is for other ways to save or discard',
      'Do not run destructive actions without a confirmation in onAction',
    ],
  },
  accessibility: [
    'State changes are announced through a polite live region that stays mounted while the bar is hidden',
    'A failed save is announced as an alert',
    'Focus stays where it is when the bar appears; the bar is reached with Tab after the form fields',
    'When the bar hides while focus is inside it, focus moves to the element from getReturnFocusTarget, otherwise to the form named by formId or its first enabled field; focus outside the bar is never moved',
    'The block registers no keyboard shortcuts',
    'A blocked Save stays focusable and is described by its reason',
    'The entrance animation is skipped when the user prefers reduced motion',
  ],
  faq: [
    {
      question: 'Why does the floating bar cover the last field?',
      answer:
        'The floating placement is fixed to the viewport and takes no space in the page. Add FORM_SAVE_BAR_FLOATING_SPACER_CLASS to the scrolling container.',
    },
    {
      question: 'Why does the container bar not stick?',
      answer:
        'It sticks to the nearest scrolling ancestor. Render it as a direct child at the end of the element that has overflow-y-auto.',
    },
    {
      question: 'Why is the floating bar positioned against a panel and not the window?',
      answer: 'An ancestor with a transform or filter becomes the reference for fixed elements. Move the bar outside that ancestor.',
    },
  ],
  tokens: [
    '--card',
    '--border',
    '--shadow-lg',
    '--radius-card',
    '--z-index-sticky',
    '--status-success-text',
    '--status-success-icon',
    '--status-error-text',
    '--status-error-icon',
    '--status-neutral-icon',
  ],
  variants: [
    {
      id: 'interactive',
      title: 'Interactive',
      description: 'Edit a field to show the bar. Save runs for a moment, confirms with the time and then hides the bar again.',
      render: () => <InteractiveExample />,
      code: formSaveBarCode(`  saveState={isDirty ? 'dirty' : justSaved ? 'saved' : 'idle'}
  savedAt={savedAt}
  onSave={async () => {
    await saveCompany(values)
    markSaved()
  }}
  onReset={() => reset(savedValues)}`),
    },
    {
      id: 'dirty',
      title: 'Unsaved changes',
      render: () => <FormSaveBar {...formSaveBarFixtures.dirty} />,
      code: formSaveBarCode(`  saveState="dirty"
  placement="inline"
  onSave={save}
  onReset={reset}`),
    },
    {
      id: 'saving',
      title: 'Saving',
      render: () => <FormSaveBar {...formSaveBarFixtures.saving} />,
      code: formSaveBarCode(`  saveState="saving"
  placement="inline"
  onSave={save}
  onReset={reset}`),
    },
    {
      id: 'saved',
      title: 'Saved with time',
      render: () => <FormSaveBar {...formSaveBarFixtures.saved} />,
      code: formSaveBarCode(`  saveState="saved"
  savedAt="2026-03-12T10:15:00Z"
  placement="inline"
  onSave={save}
  onReset={reset}`),
    },
    {
      id: 'failed',
      title: 'Failed with a message',
      description: 'Save stays enabled and works as a retry.',
      render: () => <FormSaveBar {...formSaveBarFixtures.failed} />,
      code: formSaveBarCode(`  saveState="failed"
  message={t(connectionLostKey)}
  placement="inline"
  onSave={save}
  onReset={reset}`),
    },
    {
      id: 'with-actions',
      title: 'With extra actions',
      description: 'Every extra action lives in the more menu, destructive ones included.',
      render: () => <FormSaveBar {...formSaveBarFixtures.withActions} />,
      code: formSaveBarCode(`  saveState="dirty"
  placement="inline"
  onSave={save}
  onReset={reset}
  actions={[
    { key: 'save-copy', label: 'Save as copy', icon: 'copy' },
    { key: 'save-draft', label: 'Save as draft' },
    { key: 'delete', label: 'Delete record', icon: 'trash-2', tone: 'destructive' },
  ]}
  onAction={handleAction}`),
    },
    {
      id: 'save-disabled',
      title: 'Save disabled with a reason',
      render: () => <FormSaveBar {...formSaveBarFixtures.saveDisabled} />,
      code: formSaveBarCode(`  saveState="dirty"
  placement="inline"
  onSave={save}
  onReset={reset}
  saveDisabledReason="Fill in the company name before saving"`),
    },
    {
      id: 'container',
      title: 'Container placement',
      description: 'The bar sticks to the bottom of the scrolling panel. Scroll the fields to see it stay in place.',
      render: () => <ContainerExample />,
      code: `import { FormSaveBar } from '@open-mercato/ui/blocks/form-save-bar'

<div className="h-72 overflow-y-auto">
  <form id="company-form" onSubmit={handleSubmit} className="p-4">
    <CompanyFields />
  </form>
  <FormSaveBar
    placement="container"
    saveState={saveState}
    formId="company-form"
    onReset={reset}
  />
</div>`,
    },
    {
      id: 'always-visible',
      title: 'Always visible',
      description: 'With alwaysVisible the bar stays while idle; Save and Reset wait for a change.',
      render: () => <FormSaveBar {...formSaveBarFixtures.alwaysVisible} />,
      code: formSaveBarCode(`  saveState="idle"
  alwaysVisible
  placement="inline"
  onSave={save}
  onReset={reset}`),
    },
    {
      id: 'floating',
      title: 'Floating placement',
      description: 'The default placement, shown here inside a frame. The scrolling area carries the spacer class so the last field clears the bar.',
      render: () => <FloatingExample />,
      code: `import { FormSaveBar, FORM_SAVE_BAR_FLOATING_SPACER_CLASS } from '@open-mercato/ui/blocks/form-save-bar'

<main className={FORM_SAVE_BAR_FLOATING_SPACER_CLASS}>
  <form id="company-form" onSubmit={handleSubmit}>
    <CompanyFields />
  </form>
  <FormSaveBar saveState={saveState} formId="company-form" onReset={reset} />
</main>`,
    },
    {
      id: 'loading',
      title: 'Loading',
      description: 'A skeleton is shown only together with alwaysVisible; otherwise a loading bar renders nothing.',
      render: () => <FormSaveBar {...formSaveBarFixtures.loading} />,
      code: formSaveBarCode(`  saveState="idle"
  alwaysVisible
  status="loading"
  placement="inline"
  onSave={save}`),
    },
  ],
}
