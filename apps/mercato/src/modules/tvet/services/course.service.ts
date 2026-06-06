import { EntityManager } from '@mikro-orm/postgresql'
import { Course } from '../data/entities'

export class CourseService {
  constructor(private em: EntityManager) {}

  async create(data: Partial<Course> & { organizationId: string; tenantId: string }) {
    const course = this.em.create(Course, data)
    await this.em.persist(course).flush()
    return course
  }

  async findAll(where: any = {}, options: any = {}) {
    return this.em.find(Course, where, options)
  }

  async findById(id: string, organizationId: string, tenantId: string) {
    return this.em.findOne(Course, { id, organizationId, tenantId })
  }

  async update(id: string, data: Partial<Course>, organizationId: string, tenantId: string) {
    const course = await this.findById(id, organizationId, tenantId)
    if (!course) return null
    Object.assign(course, data)
    await this.em.flush()
    return course
  }

  async delete(id: string, organizationId: string, tenantId: string) {
    const course = await this.findById(id, organizationId, tenantId)
    if (!course) return false
    course.deletedAt = new Date()
    await this.em.flush()
    return true
  }
}
