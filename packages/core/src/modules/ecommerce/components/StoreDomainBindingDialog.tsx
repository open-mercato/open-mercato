'use client'

import * as React from 'react'
import Link from 'next/link'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DomainMappingSummary } from '../lib/domainMappingSummaries'
import { DomainStatusWarning } from './DomainStatusWarning'
import {
  DOMAIN_BINDINGS_API_PATH,
  DOMAIN_SETTINGS_HREF,
  buildDomainBindingCreatePayload,
  buildDomainBindingInitialValues,
  buildDomainBindingUpdatePayload,
  describeDomainStatus,
  domainBindingFormSchema,
  findDuplicateBinding,
  formatBindingAddress,
  normalizeBindingPrefix,
  type DomainBindingFormValues,
  type DomainBindingRecord,
} from './storeDomains'

type StoreDomainBindingDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  storeId: string
  binding: DomainBindingRecord | null
  bindings: readonly DomainBindingRecord[]
  mappings: readonly DomainMappingSummary[]
  onSaved: () => void | Promise<void>
}

export function StoreDomainBindingDialog({
  open,
  onOpenChange,
  storeId,
  binding,
  bindings,
  mappings,
  onSaved,
}: StoreDomainBindingDialogProps) {
  const t = useT()

  const mappingOptions = React.useMemo(
    () =>
      mappings.map((mapping) => {
        const described = describeDomainStatus(mapping.status)
        const statusLabel = described.key ? t(described.key, described.fallback) : described.fallback
        return { value: mapping.id, label: `${mapping.hostname} (${statusLabel})` }
      }),
    [mappings, t],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'domainMappingId',
        type: 'select',
        label: t('ecommerce.backend.store.domains.form.domain', 'Domain'),
        description: t(
          'ecommerce.backend.store.domains.limitHint',
          'An organization holds at most two domains: one active plus one pending replacement. To serve another store on the same domain, give it a path prefix such as /de instead of adding a domain.',
        ),
        options: mappingOptions,
        required: true,
      },
      {
        id: 'pathPrefix',
        type: 'text',
        label: t('ecommerce.backend.store.domains.form.pathPrefix', 'Path prefix'),
        description: t(
          'ecommerce.backend.store.domains.form.pathPrefixHint',
          'Optional. Serve this store only under a path such as /de. Leave empty to serve the whole domain. When two prefixes overlap, the longest matching prefix wins.',
        ),
        placeholder: '/de',
        maxLength: 200,
        layout: 'half',
      },
      {
        id: 'isPrimary',
        type: 'checkbox',
        label: t('ecommerce.backend.store.domains.form.primary', 'Primary domain'),
        description: t(
          'ecommerce.backend.store.domains.form.primaryHint',
          'The address used for canonical links. Making this binding primary removes the primary mark from the current primary binding of this store.',
        ),
        layout: 'half',
      },
    ],
    [mappingOptions, t],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      { id: 'binding', fields: ['domainMappingId', 'pathPrefix', 'isPrimary'] },
      {
        id: 'status',
        bare: true,
        component: ({ values }) => {
          const mappingId = typeof values.domainMappingId === 'string' ? values.domainMappingId : ''
          const mapping = mappings.find((candidate) => candidate.id === mappingId)
          if (mapping) return <DomainStatusWarning status={mapping.status} hostname={mapping.hostname} appearance="alert" />
          if (mappings.length > 0) return null
          return (
            <Alert status="information">
              <AlertDescription>
                {t(
                  'ecommerce.backend.store.domains.noMappings',
                  'This organization has no domains yet. Register one in domain management, then bind it here.',
                )}{' '}
                <Link className="underline" href={DOMAIN_SETTINGS_HREF}>
                  {t('ecommerce.backend.store.domains.manageLink', 'Open domain management')}
                </Link>
              </AlertDescription>
            </Alert>
          )
        },
      },
    ],
    [mappings, t],
  )

  const initialValues = React.useMemo(() => buildDomainBindingInitialValues(binding), [binding])

  const handleSubmit = React.useCallback(
    async (values: DomainBindingFormValues) => {
      const errorMessage = binding
        ? t('ecommerce.backend.store.domains.errors.update', 'Failed to update the domain binding.')
        : t('ecommerce.backend.store.domains.errors.create', 'Failed to add the domain binding.')
      const duplicate = findDuplicateBinding(
        bindings,
        { domainMappingId: values.domainMappingId, pathPrefix: normalizeBindingPrefix(values.pathPrefix) },
        binding?.id ?? null,
      )
      if (duplicate) {
        const message = t(
          'ecommerce.errors.domainBindingDuplicate',
          'This domain and path prefix already serve a store.',
        )
        throw createCrudFormError(message, { pathPrefix: message })
      }
      if (binding) {
        await updateCrud(DOMAIN_BINDINGS_API_PATH, buildDomainBindingUpdatePayload(binding.id, values), { errorMessage })
        flash(t('ecommerce.backend.store.domains.flash.updated', 'Domain binding updated'), 'success')
      } else {
        await createCrud(DOMAIN_BINDINGS_API_PATH, buildDomainBindingCreatePayload(storeId, values), { errorMessage })
        flash(t('ecommerce.backend.store.domains.flash.created', 'Domain binding added'), 'success')
      }
      onOpenChange(false)
      await onSaved()
    },
    [binding, bindings, onOpenChange, onSaved, storeId, t],
  )

  const mapping = binding ? mappings.find((candidate) => candidate.id === binding.domainMappingId) : undefined
  const title = binding
    ? t('ecommerce.backend.store.domains.edit.title', 'Edit domain binding')
    : t('ecommerce.backend.store.domains.add.title', 'Add domain binding')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {binding && mapping
              ? formatBindingAddress(mapping.hostname, binding.pathPrefix)
              : t(
                  'ecommerce.backend.store.domains.add.description',
                  'Bind a registered domain, optionally with a path prefix, so the store becomes reachable there. Only an active domain serves.',
                )}
          </DialogDescription>
        </DialogHeader>
        <CrudForm<DomainBindingFormValues>
          key={`${binding?.id ?? 'new'}:${binding?.updatedAt ?? ''}`}
          schema={domainBindingFormSchema}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          optimisticLockUpdatedAt={binding?.updatedAt ?? null}
          submitLabel={
            binding
              ? t('ecommerce.backend.store.domains.edit.submit', 'Save binding')
              : t('ecommerce.backend.store.domains.add.submit', 'Add binding')
          }
          onSubmit={handleSubmit}
          embedded
        />
      </DialogContent>
    </Dialog>
  )
}
