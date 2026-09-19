import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { listTaxProviders } from '../../lib/providers'

const logger = createLogger('sales')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.settings.view'] },
}

/**
 * Lists the registered tax providers so the settings page can render a select
 * and the selected provider's own option fields.
 *
 * It returns field *definitions* only, never values: a provider's configured
 * settings live on the organization's settings row and are served by
 * `/api/sales/settings/tax-provider`, and its credentials never leave the
 * integrations module at all.
 */
export async function GET() {
  try {
    const items = listTaxProviders().map((provider) => ({
      key: provider.key,
      label: provider.label,
      description: provider.description ?? null,
      integrationId: provider.integrationId ?? null,
      capabilities: provider.capabilities ?? null,
      // registerTaxProvider already strips `secret` fields, so this cannot leak
      // one; the filter is a second, explicit guarantee at the wire boundary.
      fields: (provider.settings?.fields ?? []).filter((field) => field.type !== 'secret'),
    }))
    return NextResponse.json({ items })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('sales.tax-providers.get failed', { err })
    return NextResponse.json(
      { error: translate('sales.settings.errors.load_failed', 'Failed to load sales settings') },
      { status: 400 }
    )
  }
}

const providerFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
})

const providerSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  integrationId: z.string().nullable(),
  capabilities: z
    .object({
      commit: z.boolean().optional(),
      adjust: z.boolean().optional(),
      void: z.boolean().optional(),
      recordsInvoices: z.boolean().optional(),
    })
    .nullable(),
  fields: z.array(providerFieldSchema),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Registered tax providers',
  methods: {
    GET: {
      summary: 'List tax providers',
      description:
        'Lists every registered tax provider with its non secret settings field definitions. Never returns configured values or credentials.',
      responses: [
        {
          status: 200,
          description: 'Registered tax providers',
          schema: z.object({ items: z.array(providerSchema) }),
        },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
