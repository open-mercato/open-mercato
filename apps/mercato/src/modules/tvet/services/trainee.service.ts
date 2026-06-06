import { EntityManager } from '@mikro-orm/postgresql'
import { Trainee } from '../data/entities'

export class TraineeService {
  constructor(private em: EntityManager) {}

  async create(data: Partial<Trainee> & { organizationId: string; tenantId: string }) {
    const trainee = this.em.create(Trainee, data)
    await this.em.persist(trainee).flush()
    return trainee
  }

  async findAll(where: any = {}, options: any = {}) {
    return this.em.find(Trainee, where, options)
  }

  async findById(id: string, organizationId: string, tenantId: string) {
    return this.em.findOne(Trainee, { id, organizationId, tenantId })
  }

  async update(id: string, data: Partial<Trainee>, organizationId: string, tenantId: string) {
    const trainee = await this.findById(id, organizationId, tenantId)
    if (!trainee) return null
    Object.assign(trainee, data)
    await this.em.flush()
    return trainee
  }

  async delete(id: string, organizationId: string, tenantId: string) {
    const trainee = await this.findById(id, organizationId, tenantId)
    if (!trainee) return false
    trainee.deletedAt = new Date()
    await this.em.flush()
    return true
  }
}
