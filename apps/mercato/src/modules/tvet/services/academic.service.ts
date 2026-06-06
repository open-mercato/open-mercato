import { EntityManager, FindOptions, FilterQuery } from '@mikro-orm/postgresql'
import { ClassGroup, Enrollment } from '../data/entities'

export class AcademicService {
  constructor(private em: EntityManager) {}

  // Class Groups
  async createClassGroup(data: Partial<ClassGroup> & { organizationId: string; tenantId: string }): Promise<ClassGroup> {
    const cg = this.em.create(ClassGroup, data)
    await this.em.persist(cg).flush()
    return cg
  }

  async findAllClassGroups(where: FilterQuery<ClassGroup> = {}, options: FindOptions<ClassGroup, any> = {}): Promise<ClassGroup[]> {
    return this.em.find(ClassGroup, where, { ...options, populate: ['course'] } as any)
  }

  // Enrollments
  async createEnrollment(data: Partial<Enrollment> & { organizationId: string; tenantId: string }): Promise<Enrollment> {
    const enrollment = this.em.create(Enrollment, data)
    await this.em.persist(enrollment).flush()
    return enrollment
  }

  async findAllEnrollments(where: FilterQuery<Enrollment> = {}, options: FindOptions<Enrollment, any> = {}): Promise<Enrollment[]> {
    return this.em.find(Enrollment, where, { ...options, populate: ['trainee', 'classGroup', 'classGroup.course'] } as any)
  }
}
