import { registerCommand } from '@open-mercato/shared/lib/commands'
import { QualificationLevel, Sector, OccupationalStandard, CompetencyUnit, UnitElement, PerformanceCriteria } from '../data/entities'
import { emitCrudSideEffects, parseWithCustomFields } from '@open-mercato/shared/lib/commands/helpers'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { z } from 'zod'

// Simple helper to assert entity exists
function assertFound<T>(entity: T | null | undefined, message: string): T {
  if (!entity) {
    throw new Error(message)
  }
  return entity
}

// Generic CRUD Command factory for curriculum entities
function createCurriculumCommand(entityId: string, entityClass: any, action: 'created' | 'updated' | 'deleted') {
  return {
    id: `tvet.curriculum.${entityId.split(':')[1]}.${action}`,
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

const entities = [
  { id: 'tvet:qualification_level', class: QualificationLevel },
  { id: 'tvet:sector', class: Sector },
  { id: 'tvet:occupational_standard', class: OccupationalStandard },
  { id: 'tvet:competency_unit', class: CompetencyUnit },
  { id: 'tvet:unit_element', class: UnitElement },
  { id: 'tvet:performance_criteria', class: PerformanceCriteria },
]

for (const e of entities) {
  registerCommand(createCurriculumCommand(e.id, e.class, 'created'))
  registerCommand(createCurriculumCommand(e.id, e.class, 'updated'))
  registerCommand(createCurriculumCommand(e.id, e.class, 'deleted'))
}
