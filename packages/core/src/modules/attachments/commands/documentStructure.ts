import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Attachment } from '../data/entities'
import {
  createDocumentStructureEngineRegistry,
  DOCUMENT_STRUCTURE_ENGINES_DI_KEY,
  type DocumentStructureEngineRegistry,
} from '../lib/documentStructure/engines/registry'
import { resolveMaxDocumentStructureBytes } from '../lib/documentStructure/engines/text'
import {
  ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY,
  type AttachmentDocumentStructureService,
  type DocumentStructureAccessScope,
} from '../lib/documentStructure/service'
import type { DocumentOcrMode, ExtractionStatus } from '../lib/documentStructure/types'

export const REQUEST_DOCUMENT_STRUCTURE_COMMAND_ID = 'attachments.document_structure.request'

const CURRENT_EXTRACTION_STATUSES: ReadonlySet<ExtractionStatus> = new Set(['completed', 'partial', 'skipped'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RequestDocumentStructureCommandInput = {
  attachmentId: string
  tenantId: string | null
  organizationId: string | null
  force?: boolean
  ocr?: DocumentOcrMode
}

export type RequestDocumentStructureCommandResult = {
  attachmentId: string
  extractionId: string | null
  status: ExtractionStatus
  enqueued: boolean
}

function resolveEngineRegistry(ctx: CommandRuntimeContext): Pick<DocumentStructureEngineRegistry, 'resolve'> {
  try {
    return ctx.container.resolve<DocumentStructureEngineRegistry>(DOCUMENT_STRUCTURE_ENGINES_DI_KEY)
  } catch {
    return createDocumentStructureEngineRegistry()
  }
}

function resolveRequestedByUserId(ctx: CommandRuntimeContext): string | null {
  const subject = ctx.auth?.sub
  return typeof subject === 'string' && UUID_PATTERN.test(subject) ? subject : null
}

function fileExtension(fileName: string): string | null {
  const extension = path.extname(fileName).replace(/^\./, '').toLowerCase()
  return extension.length > 0 ? extension : null
}

async function assertExtractable(
  input: RequestDocumentStructureCommandInput,
  ctx: CommandRuntimeContext,
  translate: (key: string, fallback: string) => string,
): Promise<void> {
  const em = ctx.container.resolve<EntityManager>('em')
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const attachment = await findOneWithDecryption(
    em,
    Attachment,
    { id: input.attachmentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { fields: ['id', 'fileName', 'mimeType', 'fileSize'] },
    scope,
  )
  if (!attachment) throw notFound(translate('attachments.structure.errors.notFound', 'Attachment not found'))
  if (attachment.fileSize > resolveMaxDocumentStructureBytes()) {
    throw new CrudHttpError(413, {
      error: translate('attachments.structure.errors.tooLarge', 'The file is too large for document structure extraction.'),
      code: 'too_large',
    })
  }
  const engine = resolveEngineRegistry(ctx).resolve(attachment.mimeType, fileExtension(attachment.fileName))
  if (!engine) {
    throw new CrudHttpError(422, {
      error: translate('attachments.structure.errors.unsupportedType', 'This file type does not support document structure extraction.'),
      code: 'unsupported_type',
    })
  }
}

export const requestDocumentStructureCommand: CommandHandler<
  RequestDocumentStructureCommandInput,
  RequestDocumentStructureCommandResult
> = {
  id: REQUEST_DOCUMENT_STRUCTURE_COMMAND_ID,
  isUndoable: false,
  async execute(input, ctx) {
    const { translate } = await resolveTranslations()
    const service = ctx.container.resolve<AttachmentDocumentStructureService>(ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY)
    const scope: DocumentStructureAccessScope = {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      auth: ctx.auth ?? null,
    }
    const structure = await service.getStructure({ attachmentId: input.attachmentId, scope, includeOutline: false })
    if (!structure) throw notFound(translate('attachments.structure.errors.notFound', 'Attachment not found'))
    const extraction = structure.extraction
    const hasCurrentExtraction =
      input.force !== true && extraction !== null && CURRENT_EXTRACTION_STATUSES.has(extraction.status)
    if (!hasCurrentExtraction) await assertExtractable(input, ctx, translate)
    const result = await service.requestExtraction({
      attachmentId: input.attachmentId,
      scope,
      force: input.force === true,
      ...(input.ocr ? { ocr: input.ocr } : {}),
      requestedByUserId: resolveRequestedByUserId(ctx),
    })
    if (!result) throw notFound(translate('attachments.structure.errors.notFound', 'Attachment not found'))
    return {
      attachmentId: input.attachmentId,
      extractionId: result.extractionId,
      status: result.status,
      enqueued: result.enqueued,
    }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: result.enqueued
        ? translate('attachments.structure.audit.requested', 'Document structure extraction requested')
        : translate('attachments.structure.audit.current', 'Document structure already current'),
      resourceKind: 'attachments.attachment',
      resourceId: input.attachmentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      context: { force: input.force === true, ocr: input.ocr ?? null, enqueued: result.enqueued },
    }
  },
}

registerCommand(requestDocumentStructureCommand)
