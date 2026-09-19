"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DisplayProfile } from '@open-mercato/shared/lib/display/profile'
import { MARKET_TEMPLATES, type MarketTemplateCode } from '@open-mercato/shared/lib/display/templates'
import { buildMarketProfileSections } from './MarketProfileSections'
import { MarketProfilePreview } from './MarketProfilePreview'
import { formValuesFromProfile } from './profileFromValues'

type SavedProfile = DisplayProfile & { id: string; updatedAt: string | null; isActive: boolean }
type ProfileResponse = { item: SavedProfile | null }

const TEMPLATE_CODES: MarketTemplateCode[] = ['us', 'eu']

export function MarketProfileForm() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [saved, setSaved] = React.useState<SavedProfile | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  // Remounts CrudForm after a template is applied or the market is cleared, so the form takes the
  // new initial values instead of keeping the ones it mounted with.
  const [formKey, setFormKey] = React.useState(0)
  const [pendingValues, setPendingValues] = React.useState<Record<string, unknown> | null>(null)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    const res = await apiCall<ProfileResponse>('/api/markets/display-profile')
    if (!res.ok) {
      setLoadError(t('markets.errors.saveFailed'))
      setIsLoading(false)
      return
    }
    setSaved(res.result?.item ?? null)
    setIsLoading(false)
  }, [t])

  React.useEffect(() => { void load() }, [load])

  const sections = React.useMemo(() => buildMarketProfileSections(t), [t])

  const initialValues = React.useMemo(() => {
    if (pendingValues) return pendingValues
    if (saved) return { ...formValuesFromProfile(saved), id: saved.id, updatedAt: saved.updatedAt }
    return {}
  }, [pendingValues, saved])

  const applyTemplate = React.useCallback(async (code: MarketTemplateCode) => {
    // Applying a template overwrites fields the admin may have tuned, so it asks first.
    const confirmed = await confirm({
      title: t('markets.settings.template.confirmTitle'),
      description: t('markets.settings.template.confirmBody'),
      confirmText: t('markets.settings.template.apply'),
    })
    if (!confirmed) return
    const next = formValuesFromProfile(MARKET_TEMPLATES[code])
    setPendingValues(saved ? { ...next, id: saved.id, updatedAt: saved.updatedAt } : next)
    setFormKey((key) => key + 1)
  }, [confirm, saved, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    const templateGroup: CrudFormGroup = {
      id: 'template',
      column: 1,
      title: t('markets.settings.template.label'),
      component: () => (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t('markets.settings.description')}</p>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_CODES.map((code) => (
              <Button
                key={code}
                type="button"
                variant="outline"
                onClick={() => { void applyTemplate(code) }}
              >
                {t(`markets.template.${code}`)}
              </Button>
            ))}
          </div>
          {!saved ? <Alert variant="info">{t('markets.settings.empty')}</Alert> : null}
        </div>
      ),
    }

    const fieldGroups: CrudFormGroup[] = sections.map((section) => ({
      id: section.id,
      column: 1,
      title: t(section.titleKey),
      fields: section.fields,
    }))

    const previewGroup: CrudFormGroup = {
      id: 'preview',
      column: 2,
      title: t('markets.preview.title'),
      component: ({ values }) => <MarketProfilePreview values={values} />,
    }

    return [templateGroup, ...fieldGroups, previewGroup]
  }, [applyTemplate, saved, sections, t])

  if (isLoading) return <Page><PageBody><LoadingMessage label={t('markets.settings.title')} /></PageBody></Page>
  if (loadError) return <Page><PageBody><ErrorMessage label={loadError} /></PageBody></Page>

  return (
    <Page>
      <PageBody>
        <CrudForm
          key={formKey}
          title={t('markets.settings.title')}
          titleHeadingLevel={1}
          fields={[]}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('markets.settings.template.apply')}
          deleteVisible={!!saved}
          onSubmit={async (values) => {
            const payload: Record<string, unknown> = {
              // The market code is what the server falls back to for anything the form omits.
              code: String(values.code ?? saved?.code ?? 'us'),
            }
            for (const section of sections) {
              for (const field of section.fields) {
                const raw = values[field.id]
                if (field.id === 'firstDayOfWeek') {
                  payload[field.id] = Number(raw)
                  continue
                }
                if (field.id === 'subdivisionRequired') {
                  payload[field.id] = !!raw
                  continue
                }
                // An emptied optional text field means "unset", not "the empty string".
                payload[field.id] = typeof raw === 'string' && raw.trim() === '' ? null : raw
              }
            }
            // Label keys are not editable on this form; they travel with the market template.
            payload.postalCodeLabelKey = values.postalCodeLabelKey ?? saved?.postalCodeLabelKey
            payload.subdivisionLabelKey = values.subdivisionLabelKey ?? saved?.subdivisionLabelKey
            payload.addressLine2LabelKey = values.addressLine2LabelKey ?? saved?.addressLine2LabelKey
            payload.taxLineLabelKey = values.taxLineLabelKey ?? saved?.taxLineLabelKey
            payload.taxNoteKey = values.taxNoteKey ?? saved?.taxNoteKey ?? null

            await updateCrud('markets/display-profile', payload)
            flash(t('markets.settings.saved'), 'success')
            setPendingValues(null)
            await load()
            setFormKey((key) => key + 1)
          }}
          onDelete={saved ? async () => {
            const confirmed = await confirm({
              title: t('markets.settings.clearConfirmTitle'),
              description: t('markets.settings.clearConfirmBody'),
              confirmText: t('markets.settings.clear'),
              variant: 'destructive',
            })
            if (!confirmed) return
            await deleteCrud('markets/display-profile', { body: { id: saved.id } })
            flash(t('markets.settings.cleared'), 'success')
            setPendingValues(null)
            await load()
            setFormKey((key) => key + 1)
          } : undefined}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

export default MarketProfileForm
