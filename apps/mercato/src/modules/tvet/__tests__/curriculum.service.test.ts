import { CurriculumService } from '../services/curriculum.service'
import { QualificationLevel, Sector, OccupationalStandard, CompetencyUnit } from '../data/entities'

describe('CurriculumService', () => {
  let curriculumService: CurriculumService
  let mockEm: any

  beforeEach(() => {
    mockEm = {
      create: jest.fn(),
      persist: jest.fn().mockReturnThis(),
      flush: jest.fn().mockResolvedValue(undefined),
      find: jest.fn(),
      findOne: jest.fn(),
    }
    curriculumService = new CurriculumService(mockEm)
  })

  it('should create a qualification level', async () => {
    const data = { name: 'KNQF Level 6', level: 6, description: 'Diploma' }
    const ql = { id: 'uuid-ql', ...data }
    mockEm.create.mockReturnValue(ql)

    const result = await curriculumService.createQualificationLevel(data)

    expect(mockEm.create).toHaveBeenCalledWith(QualificationLevel, data)
    expect(result).toEqual(ql)
  })

  it('should find all sectors', async () => {
    const sectors = [{ id: '1', name: 'Agriculture' }]
    mockEm.find.mockResolvedValue(sectors)

    const result = await curriculumService.findAllSectors()

    expect(mockEm.find).toHaveBeenCalledWith(Sector, {})
    expect(result).toEqual(sectors)
  })

  it('should create an occupational standard', async () => {
    const data = { title: 'ICT Technician', code: 'ICT/OS/001' }
    const os = { id: 'uuid-os', ...data }
    mockEm.create.mockReturnValue(os)

    const result = await curriculumService.createOccupationalStandard(data)

    expect(mockEm.create).toHaveBeenCalledWith(OccupationalStandard, data)
    expect(result).toEqual(os)
  })

  it('should create a competency unit', async () => {
    const data = { title: 'Communication Skills', code: 'BC/01', unitType: 'basic' }
    const unit = { id: 'uuid-unit', ...data }
    mockEm.create.mockReturnValue(unit)

    const result = await curriculumService.createCompetencyUnit(data)

    expect(mockEm.create).toHaveBeenCalledWith(CompetencyUnit, data)
    expect(result).toEqual(unit)
  })
})
