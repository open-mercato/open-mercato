import { registerCommand } from '@open-mercato/shared/lib/commands'
import { Trainee } from '../../data/entities'
import { traineeCreateSchema, traineeUpdateSchema } from '../../data/validators'
import { emitCrudSideEffects, parseWithCustomFields } from '@open-mercato/shared/lib/commands/helpers'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { assertFound } from '../../../../shared/commands/shared'

export const createTraineeCommand: CommandHandler = {
  id: 'tvet.academics.trainees.create',
  async execute(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(traineeCreateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')
    const trainee = em.create(Trainee, parsed)
    await em.persist(trainee).flush()

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: trainee,
      identifiers: {
        id: trainee.id,
        tenantId: trainee.tenantId,
        organizationId: trainee.organizationId,
      },
      events: { module: 'tvet', entity: 'trainee' },
    })

    return { id: trainee.id }
  }
}

export const updateTraineeCommand: CommandHandler = {
  id: 'tvet.academics.trainees.update',
  async execute(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(traineeUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')
    const trainee = await em.findOne(Trainee, { id: parsed.id })
    const record = assertFound(trainee, 'Trainee not found')

    Object.assign(record, parsed)
    await em.flush()

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
      },
      events: { module: 'tvet', entity: 'trainee' },
    })

    return { id: record.id }
  }
}

export const deleteTraineeCommand: CommandHandler = {
  id: 'tvet.academics.trainees.delete',
  async execute(rawInput: any, ctx) {
    const id = rawInput.id || rawInput.query?.id
    const em = ctx.container.resolve<EntityManager>('em')
    const trainee = await em.findOne(Trainee, { id })
    const record = assertFound(trainee, 'Trainee not found')

    record.deletedAt = new Date()
    await em.flush()

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
      },
      events: { module: 'tvet', entity: 'trainee' },
    })

    return { id: record.id }
  }
}

registerCommand(createTraineeCommand)
registerCommand(updateTraineeCommand)
registerCommand(deleteTraineeCommand)
