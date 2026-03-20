'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SudoProvider } from './SudoProvider'
import { useSudoChallenge } from './hooks/useSudoChallenge'
import {
  buildSudoConfigInitialValues,
  buildSudoConfigPayload,
  createSudoConfigFormFields,
  createSudoConfigFormSchema,
  type SudoConfigFormValues,
} from './SudoConfigForm'

type SudoConfigRecord = {
  id: string
  tenantId: string | null
  organizationId: string | null
  label: string | null
  targetIdentifier: string
  isEnabled: boolean
  ttlSeconds: number
  challengeMethod: SudoConfigFormValues['challengeMethod']
}

type SudoConfigCrudPageProps = {
  mode: 'create' | 'edit'
  id?: string
  defaultTtlSeconds?: number
  maxTtlSeconds?: number
}

function SudoConfigCrudPageInner({
  mode,
  id,
  defaultTtlSeconds,
  maxTtlSeconds,
}: SudoConfigCrudPageProps) {
  const t = useT()
  const router = useRouter()
  const { requireSudo } = useSudoChallenge()
  const [initialValues, setInitialValues] = React.useState<SudoConfigFormValues>(() => buildSudoConfigInitialValues(
    undefined,
    { defaultTtlSeconds },
  ))
  const [loading, setLoading] = React.useState(mode === 'edit')
  const [submitting, setSubmitting] = React.useState(false)
  const schema = React.useMemo(
    () => createSudoConfigFormSchema(t, { maxTtlSeconds }),
    [maxTtlSeconds, t],
  )
  const fields = React.useMemo(() => createSudoConfigFormFields(t, { disabled: submitting }), [submitting, t])
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'target',
      title: t('security.admin.sudo.form.group.target', 'Sudo target'),
      column: 1,
      fields: ['targetIdentifier', 'label'],
    },
    {
      id: 'details',
      title: t('security.admin.sudo.form.group.details', 'Configuration'),
      column: 1,
      fields: ['tenantId', 'organizationId', 'ttlSeconds', 'challengeMethod', 'isEnabled'],
    },
  ], [t])
  const redirectWithFlash = React.useCallback((message: string, type: 'success' | 'error' = 'success') => {
    router.push(`/backend/security/sudo?flash=${encodeURIComponent(message)}&type=${type}`)
  }, [router])

  React.useEffect(() => {
    if (mode !== 'edit' || !id) return

    const configId = id
    let cancelled = false

    async function loadConfig() {
      setLoading(true)
      const response = await apiCall<SudoConfigRecord>(`/api/security/sudo/configs/${encodeURIComponent(configId)}`)
      if (!cancelled) {
        if (response.ok && response.result) {
          setInitialValues(buildSudoConfigInitialValues({
            id: response.result.id,
            tenantId: response.result.tenantId ?? '',
            organizationId: response.result.organizationId ?? '',
            label: response.result.label ?? '',
            targetIdentifier: response.result.targetIdentifier,
            isEnabled: response.result.isEnabled,
            ttlSeconds: response.result.ttlSeconds,
            challengeMethod: response.result.challengeMethod,
          }, { defaultTtlSeconds }))
        } else {
          redirectWithFlash(t('security.admin.sudo.errors.load', 'Failed to load sudo configuration.'), 'error')
        }
        setLoading(false)
      }
    }

    void loadConfig()

    return () => {
      cancelled = true
    }
  }, [defaultTtlSeconds, id, mode, redirectWithFlash, t])

  const requestToken = React.useCallback(async () => {
    const sudoToken = await requireSudo('security.sudo.manage')
    if (!sudoToken) {
      flash(t('security.admin.sudo.flash.cancelled', 'Sudo challenge cancelled.'), 'error')
      return null
    }
    return sudoToken
  }, [requireSudo, t])

  const handleSubmit = React.useCallback(async (values: SudoConfigFormValues) => {
    const sudoToken = await requestToken()
    if (!sudoToken) return

    setSubmitting(true)
    try {
      const payload = buildSudoConfigPayload(values)
      if (mode === 'edit' && id) {
        const configId = id
        await updateCrud(`security/sudo/configs/${encodeURIComponent(configId)}`, payload, {
          headers: { 'x-sudo-token': sudoToken },
          errorMessage: t('security.admin.sudo.flash.saveError', 'Failed to save sudo configuration.'),
        })
        redirectWithFlash(t('security.admin.sudo.flash.updated', 'Sudo configuration updated.'))
      } else {
        await createCrud('security/sudo/configs', payload, {
          headers: { 'x-sudo-token': sudoToken },
          errorMessage: t('security.admin.sudo.flash.saveError', 'Failed to save sudo configuration.'),
        })
        redirectWithFlash(t('security.admin.sudo.flash.created', 'Sudo configuration created.'))
      }
    } finally {
      setSubmitting(false)
    }
  }, [id, mode, redirectWithFlash, requestToken, t])

  const handleDelete = React.useCallback(async () => {
    if (mode !== 'edit' || !id) return

    const configId = id
    const sudoToken = await requestToken()
    if (!sudoToken) return

    setSubmitting(true)
    try {
      await deleteCrud(`security/sudo/configs/${encodeURIComponent(configId)}`, {
        headers: { 'x-sudo-token': sudoToken },
        errorMessage: t('security.admin.sudo.flash.deleteError', 'Failed to delete sudo configuration.'),
      })
      redirectWithFlash(t('security.admin.sudo.flash.deleted', 'Sudo configuration deleted.'))
    } finally {
      setSubmitting(false)
    }
  }, [id, mode, redirectWithFlash, requestToken, t])

  return (
    <Page>
      <PageBody>
        <CrudForm<SudoConfigFormValues>
          title={mode === 'edit'
            ? t('security.admin.sudo.form.title.edit', 'Edit sudo rule')
            : t('security.admin.sudo.form.title.create', 'Create sudo rule')}
          backHref="/backend/security/sudo"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          isLoading={loading}
          loadingMessage={t('security.admin.sudo.loading', 'Loading sudo configuration...')}
          cancelHref="/backend/security/sudo"
          submitLabel={mode === 'edit' ? t('ui.actions.save', 'Save') : t('ui.actions.create', 'Create')}
          schema={schema}
          onSubmit={handleSubmit}
          onDelete={mode === 'edit' ? handleDelete : undefined}
        />
      </PageBody>
    </Page>
  )
}

export default function SudoConfigCrudPage(props: SudoConfigCrudPageProps) {
  return (
    <SudoProvider>
      <SudoConfigCrudPageInner {...props} />
    </SudoProvider>
  )
}
