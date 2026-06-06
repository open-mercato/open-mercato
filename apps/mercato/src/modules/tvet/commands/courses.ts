import { registerCommand } from '@open-mercato/shared/lib/commands'
import { Course } from '../data/entities'
import { courseCreateSchema, courseUpdateSchema } from '../data/validators'
import { emitCrudSideEffects, parseWithCustomFields } from '@open-mercato/shared/lib/commands/helpers'
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

export const createCourseCommand: CommandHandler = {
  id: 'tvet.academics.courses.create',
  async execute(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(courseCreateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')
    const course = em.create(Course, parsed)
    await em.persist(course).flush()

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: course,
      identifiers: {
        id: course.id,
        tenantId: course.tenantId,
        organizationId: course.organizationId,
      },
      events: { module: 'tvet', entity: 'course' },
    })

    return { id: course.id }
  }
}

export const updateCourseCommand: CommandHandler = {
  id: 'tvet.academics.courses.update',
  async execute(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(courseUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')
    const course = await em.findOne(Course, { id: parsed.id })
    const record = assertFound(course, 'Course not found')

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
      events: { module: 'tvet', entity: 'course' },
    })

    return { id: record.id }
  }
}

export const deleteCourseCommand: CommandHandler = {
  id: 'tvet.academics.courses.delete',
  async execute(rawInput: any, ctx) {
    const id = rawInput.id || rawInput.query?.id
    const em = ctx.container.resolve<EntityManager>('em')
    const course = await em.findOne(Course, { id })
    const record = assertFound(course, 'Course not found')

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
      events: { module: 'tvet', entity: 'course' },
    })

    return { id: record.id }
  }
}

registerCommand(createCourseCommand)
registerCommand(updateCourseCommand)
registerCommand(deleteCourseCommand)
