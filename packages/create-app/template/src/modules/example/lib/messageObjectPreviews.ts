import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ObjectPreviewData } from '@open-mercato/shared/modules/messages/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Todo } from '../data/entities'

type PreviewContext = {
  tenantId: string
  organizationId?: string | null
}

async function resolveEm() {
  const { resolve } = await createRequestContainer()
  return resolve('em') as EntityManager
}

export async function loadTodoPreview(entityId: string, ctx: PreviewContext): Promise<ObjectPreviewData> {
  const { t } = await resolveTranslations()
  const defaultTitle = t('example.messageObjects.todo.title')
  const doneLabel = t('example.todos.form.fields.isDone.label')

  const em = await resolveEm()
  const where: Record<string, unknown> = {
    id: entityId,
    tenantId: ctx.tenantId,
    deletedAt: null,
  }
  if (ctx.organizationId) where.organizationId = ctx.organizationId

  const todo = await findOneWithDecryption(
    em,
    Todo,
    where,
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!todo) {
    return {
      title: defaultTitle,
      subtitle: entityId,
      status: t('example.messageObjects.notFound'),
      statusColor: 'gray',
    }
  }

  return {
    title: todo.title,
    metadata: {
      [doneLabel]: todo.isDone ? t('common.yes', 'Yes') : t('common.no', 'No'),
    },
  }
}

