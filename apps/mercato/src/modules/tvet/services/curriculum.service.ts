import { EntityManager, FindOptions, FilterQuery } from '@mikro-orm/postgresql'
import { QualificationLevel, Sector, OccupationalStandard, CompetencyUnit, UnitElement, PerformanceCriteria } from '../data/entities'

export class CurriculumService {
  constructor(private em: EntityManager) {}

  // Qualification Levels
  async createQualificationLevel(data: Partial<QualificationLevel> & { organizationId: string; tenantId: string }): Promise<QualificationLevel> {
    const ql = this.em.create(QualificationLevel, data)
    await this.em.persist(ql).flush()
    return ql
  }

  async findAllQualificationLevels(where: FilterQuery<QualificationLevel> = {}): Promise<QualificationLevel[]> {
    return this.em.find(QualificationLevel, where, { orderBy: { level: 'asc' } })
  }

  // Sectors
  async createSector(data: Partial<Sector> & { organizationId: string; tenantId: string }): Promise<Sector> {
    const sector = this.em.create(Sector, data)
    await this.em.persist(sector).flush()
    return sector
  }

  async findAllSectors(where: FilterQuery<Sector> = {}): Promise<Sector[]> {
    return this.em.find(Sector, where)
  }

  // Occupational Standards
  async createOccupationalStandard(data: Partial<OccupationalStandard> & { organizationId: string; tenantId: string }): Promise<OccupationalStandard> {
    const os = this.em.create(OccupationalStandard, data)
    await this.em.persist(os).flush()
    return os
  }

  async findAllOccupationalStandards(where: FilterQuery<OccupationalStandard> = {}, options: FindOptions<OccupationalStandard, any> = {}): Promise<OccupationalStandard[]> {
    return this.em.find(OccupationalStandard, where, { ...options, populate: ['qualificationLevel', 'sector'] } as any)
  }

  // Competency Units
  async createCompetencyUnit(data: Partial<CompetencyUnit> & { organizationId: string; tenantId: string }): Promise<CompetencyUnit> {
    const unit = this.em.create(CompetencyUnit, data)
    await this.em.persist(unit).flush()
    return unit
  }

  async findAllCompetencyUnits(where: FilterQuery<CompetencyUnit> = {}, options: FindOptions<CompetencyUnit, any> = {}): Promise<CompetencyUnit[]> {
    return this.em.find(CompetencyUnit, where, { ...options, populate: ['occupationalStandard'] } as any)
  }

  // Unit Elements
  async createUnitElement(data: Partial<UnitElement> & { organizationId: string; tenantId: string }): Promise<UnitElement> {
    const element = this.em.create(UnitElement, data)
    await this.em.persist(element).flush()
    return element
  }

  async findAllUnitElements(where: FilterQuery<UnitElement> = {}, options: FindOptions<UnitElement, any> = {}): Promise<UnitElement[]> {
    return this.em.find(UnitElement, where, { ...options, populate: ['competencyUnit'] } as any)
  }

  // Performance Criteria
  async createPerformanceCriteria(data: Partial<PerformanceCriteria> & { organizationId: string; tenantId: string }): Promise<PerformanceCriteria> {
    const pc = this.em.create(PerformanceCriteria, data)
    await this.em.persist(pc).flush()
    return pc
  }

  async findAllPerformanceCriteria(where: FilterQuery<PerformanceCriteria> = {}, options: FindOptions<PerformanceCriteria, any> = {}): Promise<PerformanceCriteria[]> {
    return this.em.find(PerformanceCriteria, where, { ...options, populate: ['unitElement'] } as any)
  }
}
