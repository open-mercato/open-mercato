'use client'

/**
 * Saudi VAT settings â€” the seller identity the ZATCA invoice QR is built from.
 *
 * The screen exists because the values are a compliance input, not a preference:
 * the VAT registration number and the seller name are what ZATCA reads out of the
 * QR code, and a missing one means no invoice may be issued at all. The
 * completeness banner says that in the interface rather than letting an operator
 * discover it from a rejected invoice.
 *
 * Every write goes through `runMutation` (the page cannot use `CrudForm` â€” the
 * record has no list, no create and no delete) so mutation guards and injected
 * validation run exactly as they do on a CRUD screen.
 *
 * Read and write are separate grants: the screen opens on
 * `saudi_localization.settings.view`, the save needs `settings.manage`. A caller
 * holding only the first must still be able to read the seller identity, which is
 * what `view` promises, so the API reports which of the two states applies and
 * the form degrades to a read-only view instead of offering a Save the guard will
 * refuse. Disabling the inputs matters as much as hiding the button: an editable
 * form that silently discards the edit is the same defect with a later error.
 */

import * as React from 'react'
import { Save } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const SETTINGS_API = '/api/saudi_localization/vat-settings'
const MUTATION_CONTEXT_ID = 'saudi-localization.vat-settings'
const RESOURCE_KIND = 'saudi_localization.settings'
const RESOURCE_ID = 'vat'
const DEFAULT_RATE_PERCENT = '15'

type FilingFrequency = 'monthly' | 'quarterly'

type VatSettingsResponse = {
  sellerName: string
  vatRegistrationNumber: string
  commercialRegistrationNumber: string | null
  vatRate: number
  invoiceQrEnabled: boolean
  filingFrequency: FilingFrequency
  isComplete: boolean
  canManage: boolean
  updatedAt: string | null
}

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

type FormState = {
  sellerName: string
  vatRegistrationNumber: string
  commercialRegistrationNumber: string
  vatRatePercent: string
  invoiceQrEnabled: boolean
  filingFrequency: FilingFrequency
}

const EMPTY_FORM: FormState = {
  sellerName: '',
  vatRegistrationNumber: '',
  commercialRegistrationNumber: '',
  vatRatePercent: DEFAULT_RATE_PERCENT,
  invoiceQrEnabled: true,
  filingFrequency: 'quarterly',
}

function toFormState(settings: VatSettingsResponse): FormState {
  return {
    sellerName: settings.sellerName,
    vatRegistrationNumber: settings.vatRegistrationNumber,
    commercialRegistrationNumber: settings.commercialRegistrationNumber ?? '',
    vatRatePercent: String(Number((settings.vatRate * 100).toFixed(2))),
    invoiceQrEnabled: settings.invoiceQrEnabled,
    filingFrequency: settings.filingFrequency ?? 'quarterly',
  }
}

/** Accepts the comma decimal separator a Latin-keyboard operator types (`15,5`). */
function parseRatePercent(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const percent = Number(normalized)
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null
  return percent
}

export default function SaudiVatSettingsPage() {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('saudi_localization.errors.save_failed', 'Unable to save the Saudi VAT settings.'),
  })

  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)
  const [isComplete, setIsComplete] = React.useState(false)
  const [canManage, setCanManage] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [rateError, setRateError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    const call = await apiCall<VatSettingsResponse>(SETTINGS_API)
    if (!call.ok || !call.result) {
      setLoadError(t('saudi_localization.errors.load_failed', 'Unable to load the Saudi VAT settings.'))
      setIsLoading(false)
      return
    }
    setForm(toFormState(call.result))
    setIsComplete(call.result.isComplete)
    setCanManage(call.result.canManage === true)
    setUpdatedAt(call.result.updatedAt)
    setIsLoading(false)
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const update = <TKey extends keyof FormState>(key: TKey, value: FormState[TKey]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // No Save control is rendered without the grant; this keeps a stray submit
    // (an Enter key in a field, an injected script) from reaching the guard.
    if (!canManage) return
    const ratePercent = parseRatePercent(form.vatRatePercent)
    if (ratePercent === null) {
      setRateError(t('saudi_localization.errors.invalid_rate', 'Enter a VAT rate between 0 and 100.'))
      return
    }
    setRateError(null)
    setIsSaving(true)

    const body = {
      sellerName: form.sellerName.trim(),
      vatRegistrationNumber: form.vatRegistrationNumber.trim(),
      commercialRegistrationNumber: form.commercialRegistrationNumber.trim() || null,
      vatRate: ratePercent / 100,
      invoiceQrEnabled: form.invoiceQrEnabled,
      filingFrequency: form.filingFrequency,
    }

    try {
      const call = await runMutation({
        // The expected version rides in the extension header, so a stale tab is
        // refused with a 409 the guarded mutation turns into the conflict banner.
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () =>
            apiCallOrThrow<VatSettingsResponse>(SETTINGS_API, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
          ),
        context: {
          formId: MUTATION_CONTEXT_ID,
          resourceKind: RESOURCE_KIND,
          resourceId: RESOURCE_ID,
          retryLastMutation,
        },
        mutationPayload: body,
      })
      if (!call.result) {
        flash(t('saudi_localization.errors.save_failed', 'Unable to save the Saudi VAT settings.'), 'error')
        return
      }
      setForm(toFormState(call.result))
      setIsComplete(call.result.isComplete)
      setCanManage(call.result.canManage === true)
      setUpdatedAt(call.result.updatedAt)
      flash(t('saudi_localization.vat_settings.messages.saved', 'Saudi VAT settings saved.'), 'success')
    } catch (error) {
      // A 403 means the grant was revoked under the operator (or the page was
      // opened before the grant landed). Say so instead of reporting a failure
      // whose cause is invisible, and stop offering the write.
      if ((error as { status?: number } | null)?.status === 403) {
        setCanManage(false)
        flash(
          t(
            'saudi_localization.errors.forbidden',
            'You do not have permission to change the Saudi VAT settings.',
          ),
          'error',
        )
        return
      }
      flash(t('saudi_localization.errors.save_failed', 'Unable to save the Saudi VAT settings.'), 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('saudi_localization.vat_settings.page_title', 'Saudi VAT settings')}
        description={t(
          'saudi_localization.vat_settings.page_description',
          'The seller identity printed on every tax invoice and encoded in the ZATCA QR code.',
        )}
      />
      <PageBody>
        {isLoading ? (
          <LoadingMessage label={t('saudi_localization.vat_settings.loading', 'Loading settings...')} />
        ) : null}

        {!isLoading && loadError ? (
          <ErrorMessage
            label={loadError}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                {t('saudi_localization.vat_settings.actions.retry', 'Retry')}
              </Button>
            }
          />
        ) : null}

        {!isLoading && !loadError ? (
          <form onSubmit={handleSubmit} className="grid gap-6">
            {!canManage ? (
              <Alert variant="info">
                <AlertTitle>
                  {t('saudi_localization.vat_settings.read_only.title', 'Read-only view')}
                </AlertTitle>
                <AlertDescription>
                  {t(
                    'saudi_localization.vat_settings.read_only.body',
                    'You can see the seller VAT identity but not change it. Ask an administrator for the "Manage Saudi VAT settings" permission to edit these values.',
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            {!isComplete ? (
              <Alert variant="warning">
                <AlertTitle>{t('saudi_localization.vat_settings.incomplete.title', 'VAT settings are incomplete')}</AlertTitle>
                <AlertDescription>
                  {t(
                    'saudi_localization.vat_settings.incomplete.body',
                    'Invoices cannot carry a ZATCA QR code until the seller name and a valid VAT registration number are saved.',
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>{t('saudi_localization.vat_settings.sections.seller', 'Seller identity')}</CardTitle>
                <CardDescription>
                  {t('saudi_localization.vat_settings.sections.seller_hint', 'Exactly as registered with ZATCA.')}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="saudi-seller-name">
                    {t('saudi_localization.vat_settings.fields.seller_name', 'Seller name')}
                  </Label>
                  <Input
                    id="saudi-seller-name"
                    value={form.sellerName}
                    onChange={(event) => update('sellerName', event.target.value)}
                    required
                    maxLength={255}
                    disabled={!canManage}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'saudi_localization.vat_settings.fields.seller_name_hint',
                      'Up to 255 bytes: 255 Latin characters or 127 Arabic characters.',
                    )}
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="saudi-vat-number">
                    {t('saudi_localization.vat_settings.fields.vat_number', 'VAT registration number')}
                  </Label>
                  <Input
                    id="saudi-vat-number"
                    value={form.vatRegistrationNumber}
                    onChange={(event) => update('vatRegistrationNumber', event.target.value)}
                    required
                    inputMode="numeric"
                    maxLength={15}
                    disabled={!canManage}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('saudi_localization.vat_settings.fields.vat_number_hint', '15 digits, starting and ending with 3.')}
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="saudi-cr-number">
                    {t('saudi_localization.vat_settings.fields.cr_number', 'Commercial registration number')}
                  </Label>
                  <Input
                    id="saudi-cr-number"
                    value={form.commercialRegistrationNumber}
                    onChange={(event) => update('commercialRegistrationNumber', event.target.value)}
                    maxLength={20}
                    disabled={!canManage}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('saudi_localization.vat_settings.sections.tax', 'VAT and invoice output')}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="saudi-vat-rate">{t('saudi_localization.vat_settings.fields.vat_rate', 'VAT rate (%)')}</Label>
                  <Input
                    id="saudi-vat-rate"
                    value={form.vatRatePercent}
                    onChange={(event) => update('vatRatePercent', event.target.value)}
                    required
                    inputMode="decimal"
                    disabled={!canManage}
                  />
                  {rateError ? <p className="text-xs text-destructive">{rateError}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {t('saudi_localization.vat_settings.fields.vat_rate_hint', 'The standard rate in Saudi Arabia is 15%.')}
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="saudi-filing-frequency">
                    {t('saudi_localization.vat_settings.fields.filing_frequency', 'VAT filing period')}
                  </Label>
                  <Select
                    value={form.filingFrequency}
                    onValueChange={(value) => update('filingFrequency', value as FilingFrequency)}
                    disabled={!canManage}
                  >
                    <SelectTrigger id="saudi-filing-frequency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">
                        {t('saudi_localization.vat_settings.filing_frequency.monthly', 'Monthly')}
                      </SelectItem>
                      <SelectItem value="quarterly">
                        {t('saudi_localization.vat_settings.filing_frequency.quarterly', 'Quarterly')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'saudi_localization.vat_settings.fields.filing_frequency_hint',
                      'ZATCA sets the period by turnover band. The VAT return is built for this period.',
                    )}
                  </p>
                </div>

                <SwitchField
                  id="saudi-invoice-qr"
                  checked={form.invoiceQrEnabled}
                  disabled={!canManage}
                  onCheckedChange={(checked) => update('invoiceQrEnabled', checked)}
                  label={t('saudi_localization.vat_settings.fields.invoice_qr', 'Print the ZATCA QR code on invoices')}
                  description={t(
                    'saudi_localization.vat_settings.fields.invoice_qr_hint',
                    'Required on simplified tax invoices. Turn it off only for an entity that is not VAT-registered.',
                  )}
                />
              </CardContent>
            </Card>

            {canManage ? (
              <div className="flex justify-end">
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? <Spinner size="sm" /> : <Save className="size-4 me-2" />}
                  {t('saudi_localization.vat_settings.actions.save', 'Save')}
                </Button>
              </div>
            ) : null}
          </form>
        ) : null}
      </PageBody>
    </Page>
  )
}
