import { registerCommand } from '@open-mercato/shared/lib/commands'
import { ClassGroup, Enrollment } from '../data/entities'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

// Simple helper to assert entity exists
function assertFound<T>(entity: T | null | undefined, message: string): T {
  if (!entity) {
    throw new Error(message)
  }
  return entity
}

// Generic CRUD Command factory for academic entities
function createAcademicCommand(entityId: string, entityClass: any, action: 'created' | 'updated' | 'deleted') {
  return {
    id: `tvet.academic.${entityId.split(':')[1]}.${action}`,
    async execute(rawInput: any, ctx: any) {
      const em = ctx.container.resolve<EntityManager>('em')
      let record: any

      if (action === 'created') {
        record = em.create(entityClass, rawInput)
        await em.persist(record).flush()
      } else if (action === 'updated') {
        record = await em.findOne(entityClass, { id: rawInput.id })
        assertFound(record, `${entityClass.name} not found`)
        Object.assign(record, rawInput)
        await em.flush()
      } else if (action === 'deleted') {
        const id = rawInput.id || rawInput.query?.id
        record = await em.findOne(entityClass, { id })
        assertFound(record, `${entityClass.name} not found`)
        record.deletedAt = new Date()
        await em.flush()
      }

      const de = ctx.container.resolve<DataEngine>('dataEngine')
      await emitCrudSideEffects({
        dataEngine: de,
        action,
        entity: record,
        identifiers: {
          id: record.id,
          tenantId: record.tenantId,
          organizationId: record.organizationId,
        },
        events: { module: 'tvet', entity: entityId.split(':')[1] },
      })

      return { id: record.id }
    }
  } as CommandHandler
}

const academicEntities = [
  { id: 'tvet:class_group', class: ClassGroup },
  { id: 'tvet:enrollment', class: Enrollment },
]

for (const e of academicEntities) {
  registerCommand(createAcademicCommand(e.id, e.class, 'created'))
  registerCommand(createAcademicCommand(e.id, e.class, 'updated'))
  registerCommand(createAcademicCommand(e.id, e.class, 'deleted'))
}
