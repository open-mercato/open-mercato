import { EntityManager } from '@mikro-orm/postgresql'
import { QualificationLevel, Sector, OccupationalStandard, CompetencyUnit } from '../data/entities'

export class CurriculumService {
  constructor(private em: EntityManager) {}

  // Qualification Levels
  async createQualificationLevel(data: any) {
    const ql = this.em.create(QualificationLevel, data)
    await this.em.persist(ql).flush()
    return ql
  }

  async findAllQualificationLevels(where: any = {}) {
    return this.em.find(QualificationLevel, where, { orderBy: { level: 'asc' } })
  }

  // Sectors
  async createSector(data: any) {
    const sector = this.em.create(Sector, data)
    await this.em.persist(sector).flush()
    return sector
  }

  async findAllSectors(where: any = {}) {
    return this.em.find(Sector, where)
  }

  // Occupational Standards
  async createOccupationalStandard(data: any) {
    const os = this.em.create(OccupationalStandard, data)
    await this.em.persist(os).flush()
    return os
  }

  async findAllOccupationalStandards(where: any = {}, options: any = {}) {
    return this.em.find(OccupationalStandard, where, { ...options, populate: ['qualificationLevel', 'sector'] })
  }

  // Competency Units
  async createCompetencyUnit(data: any) {
    const unit = this.em.create(CompetencyUnit, data)
    await this.em.persist(unit).flush()
    return unit
  }

  async findAllCompetencyUnits(where: any = {}, options: any = {}) {
    return this.em.find(CompetencyUnit, where, { ...options, populate: ['occupationalStandard'] })
  }
}
