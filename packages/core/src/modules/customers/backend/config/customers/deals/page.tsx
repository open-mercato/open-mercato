"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

const SAVE_CONTEXT_ID = 'customers-deals-settings:stuck-threshold'
const MIN_DAYS = 1
const MAX_DAYS = 365

export default function DealsSettingsPage(): React.ReactElement {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [value, setValue] = React.useState<string>('14')
  const [validationError, setValidationError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const settingsQuery = useQuery<{ stuckThresholdDays: number }>({
    queryKey: ['customers', 'settings', 'stuck-threshold', `scope:${scopeVersion}`],
    staleTime: 60_000,
    queryFn: async () => {
      const payload = await readApiResultOrThrow<{ stuckThresholdDays?: number }>(
        '/api/customers/settings/stuck-threshold',
        undefined,
        {
          errorMessage: translateWithFallback(
            t,
            'customers.deals.settings.loadError',
            'Failed to load deal settings.',
          ),
        },
      )
      return { stuckThresholdDays: payload?.stuckThresholdDays ?? 14 }
    },
  })

  React.useEffect(() => {
    if (settingsQuery.data) {
      setValue(String(settingsQuery.data.stuckThresholdDays))
    }
  }, [settingsQuery.data])

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: SAVE_CONTEXT_ID,
    blockedMessage: translateWithFallback(
      t,
      'ui.forms.flash.saveBlocked',
      'Save blocked by validation',
    ),
  })

  const handleSave = React.useCallback(async () => {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < MIN_DAYS || parsed > MAX_DAYS) {
      setValidationError(
        translateWithFallback(
          t,
          'customers.deals.settings.range',
          'Enter a whole number between {min} and {max}.',
          { min: MIN_DAYS, max: MAX_DAYS },
        ),
      )
      return
    }
    setValidationError(null)
    setIsSubmitting(true)
    try {
      await runMutation({
        operation: async () => {
          await apiCallOrThrow(
            '/api/customers/settings/stuck-threshold',
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ stuckThresholdDays: parsed }),
            },
            {
              errorMessage: translateWithFallback(
                t,
                'customers.deals.settings.saveError',
                'Failed to save deal settings.',
              ),
            },
          )
        },
        context: {
          formId: SAVE_CONTEXT_ID,
          resourceKind: 'customers.settings',
          retryLastMutation,
        },
      })
      flash(
        translateWithFallback(
          t,
          'customers.deals.settings.saveSuccess',
          'Deal settings saved.',
        ),
        'success',
      )
      settingsQuery.refetch().catch(() => {})
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : translateWithFallback(
              t,
              'customers.deals.settings.saveError',
              'Failed to save deal settings.',
            )
      flash(message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [retryLastMutation, runMutation, settingsQuery, t, value])

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {translateWithFallback(
                t,
                'customers.deals.settings.pageTitle',
                'Deal settings',
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {translateWithFallback(
                t,
                'customers.deals.settings.pageDescription',
                'Tune how the deals kanban surfaces stale opportunities.',
              )}
            </p>
          </header>

          <section className="flex max-w-md flex-col gap-4 rounded-lg border border-border bg-card p-6">
            {settingsQuery.isLoading ? (
              <div className="flex h-24 items-center justify-center">
                <Spinner />
              </div>
            ) : (
              <>
                <FormField
                  label={translateWithFallback(
                    t,
                    'customers.deals.settings.stuckThreshold',
                    'Stuck threshold (days)',
                  )}
                  description={translateWithFallback(
                    t,
                    'customers.deals.settings.stuckThreshold.help',
                    'A deal is flagged as stuck after this many days in its current stage.',
                  )}
                  error={validationError ?? undefined}
                  required
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={MIN_DAYS}
                    max={MAX_DAYS}
                    value={value}
                    onChange={(event) => {
                      setValue(event.target.value)
                      if (validationError) setValidationError(null)
                    }}
                  />
                </FormField>

                <div className="flex justify-end">
                  <Button
                    onClick={() => void handleSave()}
                    type="button"
                    disabled={isSubmitting || settingsQuery.isLoading}
                  >
                    {translateWithFallback(
                      t,
                      'customers.deals.settings.save',
                      'Save settings',
                    )}
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      </PageBody>
    </Page>
  )
}
