'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EntityHeader } from '@open-mercato/ui/blocks/entity-header'
import { FormSaveBar, type FormSaveState } from '@open-mercato/ui/blocks/form-save-bar'
import { Inline, Stack } from '@open-mercato/ui/blocks/stack'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { ScreenFrame, wait } from './frame'

type SupplierForm = {
  name: string
  taxId: string
  website: string
  email: string
  phone: string
  terms: string
  notes: string
  confirmations: boolean
}

type TextFieldKey = 'name' | 'taxId' | 'website' | 'email' | 'phone' | 'notes'

export type RecordFormScreenProps = {
  initial?: 'clean' | 'dirty' | 'failed'
}

const SAVED_NOTICE_MS = 2500
const SECTION_CLASS = 'rounded-card border border-border p-card'
const SECTION_TITLE_CLASS = 'text-base text-foreground'
const FIELD_CLASS = 'min-w-56 flex-1'
const SAVE_BAR_SPACER_CLASS = 'pb-36 sm:pb-24'

const SAVED_SUPPLIER: SupplierForm = {
  name: 'Harbor Tools',
  taxId: 'HT-118-640',
  website: 'harbortools.example',
  email: 'orders@harbortools.example',
  phone: '+1 555 0177',
  terms: 'net-30',
  notes: '',
  confirmations: true,
}

function isSameForm(left: SupplierForm, right: SupplierForm): boolean {
  return (Object.keys(left) as Array<keyof SupplierForm>).every((key) => left[key] === right[key])
}

export function RecordFormScreen({ initial = 'clean' }: RecordFormScreenProps) {
  const t = useT()
  const formId = React.useId()
  const [saved, setSaved] = React.useState<SupplierForm>(SAVED_SUPPLIER)
  const [draft, setDraft] = React.useState<SupplierForm>(() =>
    initial === 'clean' ? SAVED_SUPPLIER : { ...SAVED_SUPPLIER, phone: '+1 555 0190', terms: 'net-14' },
  )
  const [phase, setPhase] = React.useState<'idle' | 'saving' | 'saved' | 'failed'>(initial === 'failed' ? 'failed' : 'idle')
  const [savedAt, setSavedAt] = React.useState<string | undefined>(undefined)
  const noticeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    },
    [],
  )

  const dirty = !isSameForm(draft, saved)
  const nameMissing = draft.name.trim() === ''
  const saveState: FormSaveState = phase === 'saving' || phase === 'failed' ? phase : dirty ? 'dirty' : phase

  const setText = (key: TextFieldKey) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (nameMissing || phase === 'saving') return
    const submitted = draft
    setPhase('saving')
    await wait(900)
    setSaved(submitted)
    setSavedAt(new Date().toISOString())
    setPhase('saved')
    noticeTimer.current = setTimeout(() => setPhase((current) => (current === 'saved' ? 'idle' : current)), SAVED_NOTICE_MS)
  }

  const handleReset = () => {
    setDraft(saved)
    setPhase('idle')
  }

  return (
    <ScreenFrame width="narrow" className={saveState === 'idle' ? undefined : SAVE_BAR_SPACER_CLASS}>
      <EntityHeader
        backLabel={t('design_system.gallery.screens.recordForm.back', 'Suppliers')}
        onBack={() => undefined}
        title={t('design_system.gallery.screens.recordForm.title', 'Edit supplier')}
        subtitle={t('design_system.gallery.screens.recordForm.subtitle', 'These details appear on purchase orders.')}
      />
      <form id={formId} noValidate onSubmit={handleSubmit}>
        <Stack gap={6}>
          <section aria-labelledby={`${formId}-company`} className={SECTION_CLASS}>
            <Stack gap={4}>
              <h2 id={`${formId}-company`} className={SECTION_TITLE_CLASS}>
                {t('design_system.gallery.screens.recordForm.sections.company', 'Company')}
              </h2>
              <FormField
                label={t('design_system.gallery.screens.recordForm.fields.name', 'Company name')}
                required
                error={nameMissing ? t('design_system.gallery.screens.recordForm.errors.nameRequired', 'Enter the company name') : undefined}
              >
                <Input value={draft.name} onChange={setText('name')} autoComplete="off" />
              </FormField>
              <Inline gap={4} wrap>
                <FormField className={FIELD_CLASS} label={t('design_system.gallery.screens.recordForm.fields.taxId', 'Tax ID')}>
                  <Input value={draft.taxId} onChange={setText('taxId')} autoComplete="off" />
                </FormField>
                <FormField className={FIELD_CLASS} label={t('design_system.gallery.screens.recordForm.fields.website', 'Website')}>
                  <Input value={draft.website} onChange={setText('website')} autoComplete="off" />
                </FormField>
              </Inline>
            </Stack>
          </section>
          <section aria-labelledby={`${formId}-contact`} className={SECTION_CLASS}>
            <Stack gap={4}>
              <h2 id={`${formId}-contact`} className={SECTION_TITLE_CLASS}>
                {t('design_system.gallery.screens.recordForm.sections.contact', 'Order contact')}
              </h2>
              <Inline gap={4} wrap>
                <FormField className={FIELD_CLASS} label={t('design_system.gallery.screens.recordForm.fields.email', 'Email')}>
                  <Input type="email" value={draft.email} onChange={setText('email')} autoComplete="off" />
                </FormField>
                <FormField className={FIELD_CLASS} label={t('design_system.gallery.screens.recordForm.fields.phone', 'Phone')}>
                  <Input type="tel" value={draft.phone} onChange={setText('phone')} autoComplete="off" />
                </FormField>
              </Inline>
              <SwitchField
                label={t('design_system.gallery.screens.recordForm.fields.confirmations', 'Send order confirmations')}
                description={t('design_system.gallery.screens.recordForm.fields.confirmationsHint', 'An email goes to the order contact when a purchase order is approved.')}
                checked={draft.confirmations}
                onCheckedChange={(next) => setDraft((current) => ({ ...current, confirmations: next }))}
              />
            </Stack>
          </section>
          <section aria-labelledby={`${formId}-terms`} className={SECTION_CLASS}>
            <Stack gap={4}>
              <h2 id={`${formId}-terms`} className={SECTION_TITLE_CLASS}>
                {t('design_system.gallery.screens.recordForm.sections.terms', 'Terms')}
              </h2>
              <Select value={draft.terms} onValueChange={(next) => setDraft((current) => ({ ...current, terms: next }))}>
                <FormField label={t('design_system.gallery.screens.recordForm.fields.terms', 'Payment terms')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormField>
                <SelectContent>
                  <SelectItem value="net-14">{t('design_system.gallery.screens.recordForm.terms.net14', '14 days')}</SelectItem>
                  <SelectItem value="net-30">{t('design_system.gallery.screens.recordForm.terms.net30', '30 days')}</SelectItem>
                  <SelectItem value="net-60">{t('design_system.gallery.screens.recordForm.terms.net60', '60 days')}</SelectItem>
                </SelectContent>
              </Select>
              <FormField
                label={t('design_system.gallery.screens.recordForm.fields.notes', 'Notes for buyers')}
                description={t('design_system.gallery.screens.recordForm.fields.notesHint', 'Shown to your team when they create a purchase order.')}
              >
                <Textarea value={draft.notes} onChange={setText('notes')} rows={3} />
              </FormField>
            </Stack>
          </section>
        </Stack>
      </form>
      <FormSaveBar
        formId={formId}
        saveState={saveState}
        savedAt={savedAt}
        errorMessage={t('design_system.gallery.screens.recordForm.errors.saveFailed', 'Could not save. Check your connection and try again.')}
        saveDisabledReason={nameMissing ? t('design_system.gallery.screens.recordForm.errors.fixFields', 'Complete the required field to save') : undefined}
        onReset={handleReset}
      />
    </ScreenFrame>
  )
}
