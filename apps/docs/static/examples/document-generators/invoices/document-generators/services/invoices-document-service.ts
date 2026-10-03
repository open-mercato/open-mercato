import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BaseDocumentService } from '@open-mercato/shared/modules/document-generators'
import type {
  DocumentDataInput,
  DocumentFetchContext,
  TemplateNormalizationInput,
} from '@open-mercato/shared/modules/document-generators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildDocumentFilename } from '@open-mercato/document-generators/modules/document_generators/utils/index'
import { Invoice } from '../../data/entities'
import type { InvoiceTemplateData } from '../templates/types'

const requestSchema = z.object({ id: z.string().uuid() })

export class InvoicesDocumentService extends BaseDocumentService {
  readonly id = 'invoices'
  readonly label = 'Invoices'
  readonly module = 'invoices'
  readonly resourceKind = 'invoices.invoice'

  constructor() {
    super()
    this.registerTemplate({
      id: 'invoices.invoice',
      label: 'invoices.documents.templates.invoice.label',
      description: 'invoices.documents.templates.invoice.description',
      documentType: 'invoice',
      format: 'pdf',
      tags: ['invoices'],
      requiredFeatures: ['invoices.view'],
      filename: ({ data }) => buildDocumentFilename(data, 'invoice', 'pdf'),
      load: async () => ({
        type: 'react-pdf',
        component: (await import('../templates/invoice.pdf')).default,
      }),
    })
    this.registerTemplate({
      id: 'invoices.invoice-markdown',
      label: 'invoices.documents.templates.invoiceMarkdown.label',
      description: 'invoices.documents.templates.invoiceMarkdown.description',
      documentType: 'invoice',
      format: 'md',
      tags: ['invoices', 'markdown'],
      requiredFeatures: ['invoices.view'],
      filename: ({ data }) => buildDocumentFilename(data, 'invoice', 'md'),
      load: async () => ({
        type: 'markdown',
        render: (await import('../templates/invoice.markdown')).render,
      }),
    })
  }

  override async fetchData(
    { data }: { data: unknown },
    { container, auth }: DocumentFetchContext,
  ): Promise<Invoice> {
    const parsed = requestSchema.safeParse(data)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'invalid_request', details: parsed.error.flatten() })
    }
    const tenantId = auth?.tenantId
    const organizationId = auth?.orgId
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(403, { error: 'organization_scope_required' })
    }
    const scope = { tenantId, organizationId }
    const em = (container.resolve('em') as EntityManager).fork()
    const invoice = await findOneWithDecryption(
      em,
      Invoice,
      { id: parsed.data.id, ...scope, deletedAt: null },
      {},
      scope,
    )
    if (!invoice) throw new CrudHttpError(404, { error: 'not_found' })
    return invoice
  }

  toTemplateData({ data, locale, translate }: TemplateNormalizationInput): InvoiceTemplateData & Record<string, unknown> {
    const invoice = data as Invoice
    return {
      locale,
      isDraft: invoice.status === 'draft',
      labels: {
        title: translate('invoices.documents.templates.invoice.labels.title', 'Invoice'),
        number: translate('invoices.documents.templates.invoice.labels.number', 'Number'),
        total: translate('invoices.documents.templates.invoice.labels.total', 'Total'),
        draftWatermark: translate('invoices.documents.templates.invoice.labels.draftWatermark', 'DRAFT'),
      },
      document: { id: invoice.id, number: invoice.number },
      totals: { total: Number(invoice.totalAmount), currency: invoice.currencyCode },
    }
  }

  resourceId({ data }: DocumentDataInput): string {
    return String((data as { document?: { id?: unknown } }).document?.id ?? '')
  }

  override resourceLabel({ data }: DocumentDataInput): string | undefined {
    const number = (data as { document?: { number?: unknown } }).document?.number
    return typeof number === 'string' && number.length > 0 ? number : undefined
  }
}
