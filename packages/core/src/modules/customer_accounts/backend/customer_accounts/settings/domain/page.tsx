"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Globe } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { OrgSwitcher, type OrgOption } from './components/OrgSwitcher'
import { DomainPanel } from './components/DomainPanel'
import { RegisterDialog } from './components/RegisterDialog'
import type { DomainListResponse, DomainMappingRow, DomainConfig } from './components/types'

const STATE_LOADING = 'loading'
const STATE_LOADED = 'loaded'
const STATE_ERROR = 'error'
type LoadState = typeof STATE_LOADING | typeof STATE_LOADED | typeof STATE_ERROR

type OrgSwitcherNode = {
  id: string
  name: string
  depth: number
  selectable: boolean
  children: OrgSwitcherNode[]
}

type OrgSwitcherResponse = {
  items?: OrgSwitcherNode[]
  selectedId?: string | null
}

function flattenOrgNodes(nodes: OrgSwitcherNode[] | undefined, acc: OrgOption[] = [], depth = 0): OrgOption[] {
  if (!nodes) return acc
  for (const node of nodes) {
    if (node.selectable) {
      acc.push({ id: node.id, label: node.name, depth })
    }
    flattenOrgNodes(node.children, acc, depth + 1)
  }
  return acc
}

export default function CustomerDomainSettingsPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [orgOptions, setOrgOptions] = React.useState<OrgOption[]>([])
  const [defaultOrgId, setDefaultOrgId] = React.useState<string | null>(null)
  const [orgsLoaded, setOrgsLoaded] = React.useState(false)

  const urlOrgId = searchParams?.get('org') ?? null
  const selectedOrgId = urlOrgId ?? defaultOrgId

  const [mappings, setMappings] = React.useState<DomainMappingRow[]>([])
  const [config, setConfig] = React.useState<DomainConfig>({ cnameTarget: null, aRecordTarget: null })
  const [loadState, setLoadState] = React.useState<LoadState>(STATE_LOADING)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [registerOpen, setRegisterOpen] = React.useState(false)
  const [registerMode, setRegisterMode] = React.useState<'register' | 'change'>('register')
  const [replaceTargetId, setReplaceTargetId] = React.useState<string | null>(null)
  const [isMutating, setIsMutating] = React.useState(false)

  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<{ entityType: string; entityId?: string }>({
    contextId: 'customer_accounts:domain-settings',
  })

  const runMutationWithContext = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      return runMutation({
        operation,
        mutationPayload,
        context: { entityType: 'customer_accounts:domain_mapping' },
      })
    },
    [runMutation],
  )

  const refresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function loadOrgs() {
      try {
        const call = await apiCall<OrgSwitcherResponse>('/api/directory/organization-switcher')
        if (cancelled) return
        if (!call.ok || !call.result) {
          setOrgOptions([])
          setDefaultOrgId(null)
          return
        }
        const flat = flattenOrgNodes(call.result.items, [], 0)
        setOrgOptions(flat)
        const fallback = call.result.selectedId ?? (flat[0]?.id ?? null)
        setDefaultOrgId(fallback)
      } catch {
        if (!cancelled) {
          setOrgOptions([])
          setDefaultOrgId(null)
        }
      } finally {
        if (!cancelled) setOrgsLoaded(true)
      }
    }
    loadOrgs()
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (!orgsLoaded) return
    if (!selectedOrgId) {
      setMappings([])
      setConfig({ cnameTarget: null, aRecordTarget: null })
      setLoadState(STATE_LOADED)
      return
    }
    let cancelled = false
    async function load() {
      setLoadState(STATE_LOADING)
      try {
        const call = await apiCall<DomainListResponse>(
          `/api/customer_accounts/admin/domain-mappings?organizationId=${encodeURIComponent(selectedOrgId!)}`,
        )
        if (cancelled) return
        if (!call.ok || !call.result?.ok) {
          setLoadState(STATE_ERROR)
          return
        }
        setMappings(Array.isArray(call.result.domainMappings) ? call.result.domainMappings : [])
        setConfig(call.result.config ?? { cnameTarget: null, aRecordTarget: null })
        setLoadState(STATE_LOADED)
      } catch {
        if (!cancelled) setLoadState(STATE_ERROR)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [orgsLoaded, selectedOrgId, reloadToken])

  useAppEvent('customer_accounts.domain_mapping.*', () => {
    refresh()
  }, [refresh])

  const orderedMappings = React.useMemo(() => {
    if (mappings.length === 0) return []
    const sorted = [...mappings].sort((a, b) => {
      const aActive = a.status === 'active' ? 0 : 1
      const bActive = b.status === 'active' ? 0 : 1
      if (aActive !== bActive) return aActive - bActive
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
    return sorted
  }, [mappings])

  const primaryActiveId = React.useMemo(() => {
    const active = orderedMappings.find((m) => m.status === 'active')
    if (active) return active.id
    return orderedMappings[0]?.id ?? null
  }, [orderedMappings])

  const handleOrgChange = React.useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (next) params.set('org', next)
      else params.delete('org')
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : '?', { scroll: false })
    },
    [router, searchParams],
  )

  const handleOpenRegister = React.useCallback(() => {
    setRegisterMode('register')
    setReplaceTargetId(null)
    setRegisterOpen(true)
  }, [])

  const handleOpenChange = React.useCallback((mappingId: string) => {
    setRegisterMode('change')
    setReplaceTargetId(mappingId)
    setRegisterOpen(true)
  }, [])

  const handleSubmitRegister = React.useCallback(
    async (hostname: string) => {
      if (!selectedOrgId) {
        throw new Error(t('customer_accounts.domainMapping.error.load', 'Could not load custom-domain configuration'))
      }
      setIsMutating(true)
      try {
        await runMutationWithContext(async () => {
          const body: Record<string, unknown> = {
            hostname,
            organizationId: selectedOrgId,
          }
          if (registerMode === 'change' && replaceTargetId) {
            body.replacesDomainId = replaceTargetId
          }
          const call = await apiCall<{ ok: boolean; error?: string; domainMapping?: DomainMappingRow }>(
            '/api/customer_accounts/admin/domain-mappings',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            },
          )
          if (!call.ok || !call.result?.ok) {
            const message = call.result?.error
              || t('customer_accounts.domainMapping.alreadyClaimed', 'This domain is already in use by another organization')
            throw new Error(message)
          }
          flash(t('customer_accounts.domainMapping.registered', 'Domain registered successfully'), 'success')
          setRegisterOpen(false)
          refresh()
        })
      } finally {
        setIsMutating(false)
      }
    },
    [refresh, registerMode, replaceTargetId, runMutationWithContext, selectedOrgId, t],
  )

  const handleCheckNow = React.useCallback(
    async (mapping: DomainMappingRow) => {
      setIsMutating(true)
      try {
        await runMutationWithContext(async () => {
          const call = await apiCall<{ ok: boolean; error?: string }>(
            `/api/customer_accounts/admin/domain-mappings/${encodeURIComponent(mapping.id)}/verify`,
            { method: 'POST' },
          )
          if (!call.ok || !call.result?.ok) {
            const message = call.result?.error || t('customer_accounts.domainMapping.error.load', 'Could not load custom-domain configuration')
            flash(message, 'error')
            return
          }
          refresh()
        })
      } finally {
        setIsMutating(false)
      }
    },
    [refresh, runMutationWithContext, t],
  )

  const handleRetryTls = React.useCallback(
    async (mapping: DomainMappingRow) => {
      setIsMutating(true)
      try {
        await runMutationWithContext(async () => {
          const call = await apiCall<{ ok: boolean; error?: string }>(
            `/api/customer_accounts/admin/domain-mappings/${encodeURIComponent(mapping.id)}/health-check`,
            { method: 'POST' },
          )
          if (!call.ok || !call.result?.ok) {
            const message = call.result?.error || t('customer_accounts.domainMapping.error.load', 'Could not load custom-domain configuration')
            flash(message, 'error')
            return
          }
          refresh()
        })
      } finally {
        setIsMutating(false)
      }
    },
    [refresh, runMutationWithContext, t],
  )

  const handleRemove = React.useCallback(
    async (mapping: DomainMappingRow) => {
      const replacement = orderedMappings.find(
        (m) => m.id !== mapping.id && m.status !== 'active',
      )
      const text = replacement
        ? t('customer_accounts.domainMapping.removeConfirm.hasReplacement', 'This will also cancel the pending replacement domain ({hostname}).', { hostname: replacement.hostname })
        : t('customer_accounts.domainMapping.removeConfirm', 'Are you sure? Customers using this domain will no longer be able to reach your portal.')
      const confirmed = await confirm({
        title: t('customer_accounts.domainMapping.removeConfirm.title', 'Remove custom domain?'),
        text,
        variant: 'destructive',
        confirmText: t('customer_accounts.domainMapping.removeDomain', 'Remove Domain'),
      })
      if (!confirmed) return
      setIsMutating(true)
      try {
        await runMutationWithContext(async () => {
          const call = await apiCall<{ ok: boolean; error?: string }>(
            `/api/customer_accounts/admin/domain-mappings?id=${encodeURIComponent(mapping.id)}`,
            { method: 'DELETE' },
          )
          if (!call.ok || !call.result?.ok) {
            const message = call.result?.error || t('customer_accounts.domainMapping.error.load', 'Could not load custom-domain configuration')
            flash(message, 'error')
            return
          }
          flash(t('customer_accounts.domainMapping.removed', 'Domain removed'), 'success')
          refresh()
        })
      } finally {
        setIsMutating(false)
      }
    },
    [confirm, orderedMappings, refresh, runMutationWithContext, t],
  )

  const replaceTargetHostname = React.useMemo(() => {
    if (registerMode !== 'change' || !replaceTargetId) return null
    return orderedMappings.find((m) => m.id === replaceTargetId)?.hostname ?? null
  }, [orderedMappings, registerMode, replaceTargetId])

  return (
    <Page>
      <div className="px-3 py-3 md:px-6 md:py-4">
        <FormHeader
          mode="detail"
          title={t('customer_accounts.domainMapping.title', 'Custom Domain')}
          subtitle={t('customer_accounts.domainMapping.description', 'Map your own domain to the customer portal')}
          backHref="/backend/customer_accounts/settings"
          backLabel={t('customer_accounts.settings.title', 'Portal Settings')}
        />
      </div>

      <PageBody className="space-y-6">
        {orgOptions.length > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
            <OrgSwitcher
              options={orgOptions}
              selectedId={selectedOrgId}
              onChange={handleOrgChange}
            />
          </div>
        ) : null}

        {loadState === STATE_LOADING ? (
          <LoadingMessage label={t('customer_accounts.domainMapping.loading', 'Loading domain configuration…')} />
        ) : null}

        {loadState === STATE_ERROR ? (
          <ErrorMessage
            label={t('customer_accounts.domainMapping.error.load', 'Could not load custom-domain configuration')}
            action={
              <Button type="button" variant="outline" size="sm" onClick={refresh}>
                {t('customer_accounts.domainMapping.verifyNow', 'Check Now')}
              </Button>
            }
          />
        ) : null}

        {loadState === STATE_LOADED && orderedMappings.length === 0 && selectedOrgId ? (
          <EmptyState
            icon={<Globe className="h-8 w-8" aria-hidden />}
            title={t('customer_accounts.domainMapping.empty.title', 'No custom domain yet')}
            description={t('customer_accounts.domainMapping.empty.description', 'Connect your own domain so customers can reach the portal at a branded URL.')}
            action={{
              label: t('customer_accounts.domainMapping.empty.cta', 'Register Domain'),
              onClick: handleOpenRegister,
              icon: <Globe className="h-4 w-4" aria-hidden />,
            }}
          />
        ) : null}

        {loadState === STATE_LOADED && orderedMappings.length > 0 ? (
          <div className="space-y-4">
            {orderedMappings.map((mapping) => {
              const isReplacement = mapping.id !== primaryActiveId && mapping.status !== 'active'
              return (
                <DomainPanel
                  key={mapping.id}
                  mapping={mapping}
                  isReplacement={isReplacement}
                  cnameTarget={config.cnameTarget}
                  aRecordTarget={config.aRecordTarget}
                  busy={isMutating}
                  onCheckNow={() => handleCheckNow(mapping)}
                  onRetryTls={() => handleRetryTls(mapping)}
                  onChangeDomain={() => handleOpenChange(mapping.id)}
                  onRemove={() => handleRemove(mapping)}
                />
              )
            })}
          </div>
        ) : null}
      </PageBody>

      <RegisterDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        mode={registerMode}
        currentHostname={replaceTargetHostname}
        onSubmit={handleSubmitRegister}
      />

      {ConfirmDialogElement}
    </Page>
  )
}
