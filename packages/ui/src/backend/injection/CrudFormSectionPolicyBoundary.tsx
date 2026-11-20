'use client'

import { useEffect, useMemo, type ReactNode } from 'react'
import type { CrudFormSectionConfiguredHostLedger } from '@open-mercato/shared/lib/crud/form-sections/composition'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CrudField, CrudFormGroupComponentProps, CrudFormProps } from '../CrudForm'
import { ErrorMessage } from '../detail/ErrorMessage'
import { LoadingMessage } from '../detail/LoadingMessage'
import { crudFormSectionDescriptorKey } from './crud-form-section-composition'
import { readExplicitCrudFormSectionIdentity } from './crud-form-section-identity'
import type { CrudFormSectionValues } from './crud-form-section-runtime'
import { useRegisteredComponent } from './useRegisteredComponent'
import { useResolvedCrudFormSections, type ResolvedCrudFormSectionPolicy } from './useResolvedCrudFormSections'

const logger = createLogger('ui').child({ component: 'crud-form-sections' })

type FormPolicy<TValues extends Record<string, unknown>, TPayload> = ResolvedCrudFormSectionPolicy<CrudFormSectionValues<TValues>, TPayload>

type BoundaryProps<TValues extends Record<string, unknown>, TPayload extends Record<string, unknown>> = {
  ledger: CrudFormSectionConfiguredHostLedger
  hostId: string
  formHandle: string
  spot: string
  props: CrudFormProps<TValues, TPayload>
  children(policy: FormPolicy<TValues, TPayload>): ReactNode
}

export function CrudFormSectionPolicyBoundary<TValues extends Record<string, unknown>, TPayload extends Record<string, unknown>>(
  boundary: BoundaryProps<TValues, TPayload>,
) {
  const { hostId, props } = boundary
  const { formVariant, formOperation, resourceId } = props
  const identity = useMemo(
    () => readExplicitCrudFormSectionIdentity(hostId, { formVariant, formOperation, resourceId }),
    [hostId, formVariant, formOperation, resourceId],
  )
  useEffect(() => {
    if (!identity) logger.warn('CrudForm section host requires explicit variant, operation and resource identity', { hostId })
  }, [hostId, identity])
  if (!identity) return <CrudFormSectionPolicyError />
  return <ConfiguredForm {...boundary} identity={identity} />
}

function ConfiguredForm<TValues extends Record<string, unknown>, TPayload extends Record<string, unknown>>({
  ledger, identity, formHandle, spot, props, children,
}: BoundaryProps<TValues, TPayload> & {
  identity: NonNullable<ReturnType<typeof readExplicitCrudFormSectionIdentity>>
}) {
  const t = useT()
  const groupIds = props.groups?.map(({ id }) => id).join('\0') ?? ''
  const descriptorKeys = props.sectionDescriptors?.map(crudFormSectionDescriptorKey).join('\0')
  const { resourceKind, legacyInjectionSpotId } = props
  const inputs = useMemo(() => ({
    ledger, identity, formHandle, primarySpot: spot, legacySpot: legacyInjectionSpotId, hostResourceKind: resourceKind,
    baseGroupIds: groupIds ? groupIds.split('\0') : [],
    authoredDescriptorKeys: descriptorKeys === undefined ? undefined : descriptorKeys ? descriptorKeys.split('\0') : [],
  }), [ledger, identity, formHandle, spot, legacyInjectionSpotId, resourceKind, groupIds, descriptorKeys])
  const policy = useResolvedCrudFormSections<CrudFormSectionValues<TValues>, TPayload>(inputs)
  if (policy.state === 'failed') return <CrudFormSectionPolicyError />
  if (policy.state === 'pending') return <LoadingMessage label={props.loadingMessage ?? t('ui.forms.loading')} />
  return children(policy)
}

export function CrudFormSectionPolicyError() {
  const t = useT()
  return <ErrorMessage label={t('ui.errors.defaultTitle')} description={t('ui.errors.defaultMessage')} />
}

export function applyCrudFormSectionLayout<TValues, TPayload>(
  fields: CrudField[],
  policy: ResolvedCrudFormSectionPolicy<TValues, TPayload>,
) {
  const groups = policy.descriptors.map(({ group }) => group)
  const referenced = new Set(groups.flatMap(({ fields }) => (fields ?? []).flatMap((field) => typeof field === 'string' ? [field] : [])))
  return { groups, fields: fields.filter(({ id }) => referenced.has(id)) }
}

type SectionBodyProps = CrudFormGroupComponentProps & { children: ReactNode }

function SectionBody({ children }: SectionBodyProps) {
  return children
}

export function CrudFormSectionBody({ handle, ...props }: SectionBodyProps & { handle: string }) {
  const Resolved = useRegisteredComponent<SectionBodyProps>(handle, SectionBody)
  return <Resolved {...props} />
}
