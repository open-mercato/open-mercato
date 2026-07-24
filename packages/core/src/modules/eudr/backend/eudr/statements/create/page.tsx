"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  OrderSelectField,
  ReferencedStatementsField,
  actorRoleOptions,
  activityTypeOptions,
  commodityOptions,
  type OrderSnapshot,
  type ReferencedStatementValue,
} from '../../../../components/formConfig'
import {
  buildDuplicateSeed,
  pickUnambiguousCommodity,
  resolveSeedingParams,
  type StatementSeedSource,
} from '../../../../lib/statement-seeding'

type StatementFormValues = {
  title: string
  commodity: string
  activityType: string
  actorRole: string
  referenceNumber: string
  verificationNumber: string
  quantityKg: string
  supplementaryUnit: string
  supplementaryQuantity: string
  orderId: string
  orderSnapshot: OrderSnapshot | null
  referencedStatements: ReferencedStatementValue[]
  notes: string
} & Record<string, unknown>

type StatementListResponse = {
  items?: StatementSeedSource[]
}

type OrderListItem = {
  id?: string | null
  orderNumber?: string | null
}

type OrderListResponse = {
  items?: OrderListItem[]
}

type OrderLineItem = {
  product_id?: string | null
}

type OrderLinesResponse = {
  items?: OrderLineItem[]
  totalPages?: number
}

type ProductMappingItem = {
  commodity?: string | null
  isInScope?: boolean | null
}

type ProductMappingsResponse = {
  items?: ProductMappingItem[]
}

const SEEDING_REQUEST_INIT: RequestInit = {
  headers: {
    'x-om-forbidden-redirect': '0',
    'x-om-unauthorized-redirect': '0',
  },
}

const ORDER_LINES_PAGE_SIZE = 100
const ORDER_LINES_PAGE_CAP = 3

function createEmptyStatementValues(): StatementFormValues {
  return {
    title: '',
    commodity: '',
    activityType: '',
    actorRole: '',
    referenceNumber: '',
    verificationNumber: '',
    quantityKg: '',
    supplementaryUnit: '',
    supplementaryQuantity: '',
    orderId: '',
    orderSnapshot: null,
    referencedStatements: [],
    notes: '',
  }
}

async function loadOrderCommodity(orderId: string): Promise<string | null> {
  const productIds = new Set<string>()
  let reachedLastPage = false

  try {
    for (let page = 1; page <= ORDER_LINES_PAGE_CAP; page += 1) {
      const call = await apiCall<OrderLinesResponse>(
        `/api/sales/order-lines?orderId=${encodeURIComponent(orderId)}&page=${page}&pageSize=${ORDER_LINES_PAGE_SIZE}`,
        SEEDING_REQUEST_INIT,
        { fallback: { items: [] } },
      )
      if (!call.ok) return null

      const items = Array.isArray(call.result?.items) ? call.result.items : []
      for (const item of items) {
        if (typeof item.product_id === 'string' && item.product_id.trim()) {
          productIds.add(item.product_id.trim())
        }
      }

      const totalPages = typeof call.result?.totalPages === 'number'
        && Number.isFinite(call.result.totalPages)
        ? Math.max(0, Math.floor(call.result.totalPages))
        : null
      if ((totalPages !== null && page >= totalPages) || items.length < ORDER_LINES_PAGE_SIZE) {
        reachedLastPage = true
        break
      }
    }

    if (!reachedLastPage || productIds.size === 0) return null
    const allProductIds = Array.from(productIds)
    const mappings: Array<{ commodity: string; isInScope: boolean }> = []
    for (let offset = 0; offset < allProductIds.length; offset += 100) {
      const chunk = allProductIds.slice(offset, offset + 100)
      const call = await apiCall<ProductMappingsResponse>(
        `/api/eudr/product-mappings?productId=${encodeURIComponent(chunk.join(','))}&pageSize=100`,
        SEEDING_REQUEST_INIT,
        { fallback: { items: [] } },
      )
      if (!call.ok) return null
      for (const item of (Array.isArray(call.result?.items) ? call.result.items : [])) {
        if (typeof item.commodity === 'string' && typeof item.isInScope === 'boolean') {
          mappings.push({ commodity: item.commodity, isInScope: item.isInScope })
        }
      }
    }
    return pickUnambiguousCommodity(mappings)
  } catch {
    return null
  }
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function optionalNumber(value: unknown, translate: ReturnType<typeof useT>): number | null {
  const text = optionalText(value)
  if (!text) return null
  const parsedNumber = Number(text)
  if (!Number.isFinite(parsedNumber)) {
    const message = translate('eudr.statements.form.quantityKgInvalid')
    throw createCrudFormError(message, { quantityKg: message })
  }
  return parsedNumber
}

function optionalSupplementaryNumber(value: unknown, translate: ReturnType<typeof useT>): number | null {
  const text = optionalText(value)
  if (!text) return null
  const parsedNumber = Number(text)
  if (!Number.isFinite(parsedNumber)) {
    const message = translate('eudr.statements.form.supplementaryQuantityInvalid')
    throw createCrudFormError(message, { supplementaryQuantity: message })
  }
  return parsedNumber
}

function isOrderSnapshot(value: unknown): value is OrderSnapshot {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeReferencedStatements(value: unknown): ReferencedStatementValue[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
      const record = entry as Record<string, unknown>
      const referenceNumber = optionalText(record.referenceNumber)
      if (!referenceNumber) return null
      const verificationNumber = optionalText(record.verificationNumber)
      return verificationNumber ? { referenceNumber, verificationNumber } : { referenceNumber }
    })
    .filter((entry): entry is ReferencedStatementValue => entry !== null)
}

export default function CreateEudrStatementPage() {
  const translate = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const seedingParams = resolveSeedingParams(searchParams)
  const seedingMode = seedingParams.mode
  const seedingId = seedingMode === 'none' ? null : seedingParams.id
  const ignoredOrder = seedingMode === 'duplicate' && seedingParams.ignoredOrder === true
  const [initialValues, setInitialValues] = React.useState<StatementFormValues>(createEmptyStatementValues)
  const [seeding, setSeeding] = React.useState<boolean>(seedingMode !== 'none')

  React.useEffect(() => {
    let cancelled = false

    const flashUnavailable = () => {
      if (!cancelled) flash(translate('eudr.statements.prefillUnavailable'), 'info')
    }
    const flashIgnoredOrder = () => {
      if (!cancelled && ignoredOrder) {
        flash(translate('eudr.statements.prefillOrderIgnored'), 'info')
      }
    }

    async function seedForm() {
      setInitialValues(createEmptyStatementValues())
      if (!seedingId || seedingMode === 'none') return

      if (seedingMode === 'duplicate') {
        try {
          const call = await apiCall<StatementListResponse>(
            `/api/eudr/statements?id=${encodeURIComponent(seedingId)}`,
            SEEDING_REQUEST_INIT,
            { fallback: { items: [] } },
          )
          if (cancelled) return
          flashIgnoredOrder()
          const items = Array.isArray(call.result?.items) ? call.result.items : []
          const source = call.ok ? items.find((item) => item.id === seedingId) : null
          if (!source) {
            flashUnavailable()
            return
          }
          const seed = buildDuplicateSeed(source)
          const sourceTitle = typeof seed.title === 'string' ? seed.title : ''
          if (!sourceTitle.trim()) {
            flashUnavailable()
            return
          }
          setInitialValues({
            ...createEmptyStatementValues(),
            ...seed,
            title: translate(
              'eudr.statements.duplicateTitle',
              '{title} (copy)',
              { title: sourceTitle },
            ),
          })
        } catch {
          flashIgnoredOrder()
          flashUnavailable()
        }
        return
      }

      try {
        const call = await apiCall<OrderListResponse>(
          `/api/sales/orders?id=${encodeURIComponent(seedingId)}`,
          SEEDING_REQUEST_INIT,
          { fallback: { items: [] } },
        )
        if (cancelled) return
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const source = call.ok ? items.find((item) => item.id === seedingId) : null
        const orderNumber = typeof source?.orderNumber === 'string' ? source.orderNumber.trim() : ''
        if (!source || !orderNumber) {
          flashUnavailable()
          return
        }
        const commodity = await loadOrderCommodity(seedingId)
        if (cancelled) return
        setInitialValues({
          ...createEmptyStatementValues(),
          title: translate(
            'eudr.statements.titleFromOrder',
            'DDS — {orderNumber}',
            { orderNumber },
          ),
          orderId: seedingId,
          orderSnapshot: { orderNumber },
          ...(commodity ? { commodity } : {}),
        })
      } catch {
        flashUnavailable()
      }
    }

    void seedForm().finally(() => {
      if (!cancelled) setSeeding(false)
    })
    return () => {
      cancelled = true
    }
  }, [ignoredOrder, seedingId, seedingMode, translate])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'title',
      label: translate('eudr.statements.form.title'),
      type: 'text',
      required: true,
    },
    {
      id: 'commodity',
      layout: 'half',
      label: translate('eudr.statements.form.commodity'),
      type: 'select',
      required: true,
      options: commodityOptions(translate),
    },
    {
      id: 'activityType',
      layout: 'half',
      label: translate('eudr.statements.form.activityType'),
      type: 'select',
      options: activityTypeOptions(translate),
    },
    {
      id: 'actorRole',
      layout: 'half',
      label: translate('eudr.statements.form.actorRole'),
      type: 'select',
      options: actorRoleOptions(translate),
    },
    {
      id: 'referenceNumber',
      label: translate('eudr.statements.form.referenceNumber'),
      type: 'text',
    },
    {
      id: 'verificationNumber',
      label: translate('eudr.statements.form.verificationNumber'),
      type: 'text',
    },
    {
      id: 'quantityKg',
      layout: 'half',
      label: translate('eudr.statements.form.quantityKg'),
      type: 'text',
    },
    {
      id: 'supplementaryUnit',
      layout: 'half',
      label: translate('eudr.statements.form.supplementaryUnit'),
      type: 'text',
    },
    {
      id: 'supplementaryQuantity',
      layout: 'half',
      label: translate('eudr.statements.form.supplementaryQuantity'),
      type: 'text',
    },
    {
      id: 'orderId',
      label: translate('eudr.statements.form.order'),
      type: 'custom',
      component: ({ id, value, setValue, setFormValue }) => (
        <OrderSelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          onSnapshot={(snapshot) => setFormValue?.('orderSnapshot', snapshot)}
          placeholder={translate('eudr.statements.form.orderPlaceholder')}
          emptyLabel={translate('eudr.common.empty')}
          loadError={translate('eudr.statements.form.orderLoadError')}
        />
      ),
    },
    {
      id: 'referencedStatements',
      label: translate('eudr.statements.form.referencedStatements'),
      type: 'custom',
      component: ({ id, value, setValue, disabled }) => (
        <ReferencedStatementsField
          id={id}
          value={value}
          onChange={(nextValue) => setValue(nextValue)}
          disabled={disabled}
        />
      ),
    },
    {
      id: 'notes',
      label: translate('eudr.statements.form.notes'),
      type: 'textarea',
    },
  ], [translate])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: translate('eudr.statements.form.details'),
      column: 1,
      fields: [
        'title',
        'commodity',
        'activityType',
        'actorRole',
      ],
    },
    {
      id: 'quantities',
      title: translate('eudr.statements.form.quantities'),
      column: 1,
      fields: [
        'quantityKg',
        'supplementaryUnit',
        'supplementaryQuantity',
      ],
    },
    {
      id: 'referenced',
      title: translate('eudr.statements.form.referencedStatements'),
      column: 1,
      fields: [
        'referencedStatements',
      ],
    },
    {
      id: 'registration',
      title: translate('eudr.statements.form.registration'),
      column: 2,
      fields: [
        'referenceNumber',
        'verificationNumber',
      ],
    },
    {
      id: 'order',
      title: translate('eudr.statements.form.order'),
      column: 2,
      fields: [
        'orderId',
      ],
    },
    {
      id: 'notes',
      title: translate('eudr.common.notes'),
      column: 2,
      fields: [
        'notes',
      ],
    },
  ], [translate])

  return (
    <Page>
      <PageBody>
        {seeding ? (
          <LoadingMessage label={translate('eudr.statements.create.title')} />
        ) : (
        <CrudForm<StatementFormValues>
          title={translate('eudr.statements.create.title')}
          backHref="/backend/eudr/statements"
          cancelHref="/backend/eudr/statements"
          submitLabel={translate('eudr.statements.form.submitCreate')}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          onSubmit={async (values) => {
            const title = optionalText(values.title)
            if (!title) {
              const message = translate('eudr.statements.form.titleRequired')
              throw createCrudFormError(message, { title: message })
            }
            const commodity = optionalText(values.commodity)
            if (!commodity) {
              const message = translate('eudr.statements.form.commodityRequired')
              throw createCrudFormError(message, { commodity: message })
            }
            await createCrud('eudr/statements', {
              title,
              commodity,
              referenceNumber: optionalText(values.referenceNumber),
              verificationNumber: optionalText(values.verificationNumber),
              status: 'draft',
              activityType: optionalText(values.activityType),
              actorRole: optionalText(values.actorRole),
              quantityKg: optionalNumber(values.quantityKg, translate),
              supplementaryUnit: optionalText(values.supplementaryUnit),
              supplementaryQuantity: optionalSupplementaryNumber(values.supplementaryQuantity, translate),
              orderId: optionalText(values.orderId),
              orderSnapshot: isOrderSnapshot(values.orderSnapshot) ? values.orderSnapshot : null,
              referencedStatements: normalizeReferencedStatements(values.referencedStatements),
              notes: optionalText(values.notes),
            }, {
              errorMessage: translate('eudr.statements.form.createError'),
            })
            flash(translate('eudr.statements.form.createSuccess'), 'success')
            router.push('/backend/eudr/statements')
          }}
        />
        )}
      </PageBody>
    </Page>
  )
}
