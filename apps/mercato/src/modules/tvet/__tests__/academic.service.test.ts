import { AcademicService } from '../services/academic.service'
import { ClassGroup, Enrollment } from '../data/entities'

describe('AcademicService', () => {
  let academicService: AcademicService
  let mockEm: any

  beforeEach(() => {
    mockEm = {
      create: jest.fn(),
      persist: jest.fn().mockReturnThis(),
      flush: jest.fn().mockResolvedValue(undefined),
      find: jest.fn(),
      findOne: jest.fn(),
    }
    academicService = new AcademicService(mockEm)
  })

  it('should create a class group', async () => {
    const data = { name: 'IT Jan 2025', courseId: 'uuid-course', organizationId: 'org-1', tenantId: 'tenant-1' }
    const cg = { id: 'uuid-cg', ...data }
    mockEm.create.mockReturnValue(cg)

    const result = await academicService.createClassGroup(data)

    expect(mockEm.create).toHaveBeenCalledWith(ClassGroup, data)
    expect(result).toEqual(cg)
  })

  it('should create an enrollment', async () => {
    const data = { traineeId: 'uuid-trainee', classGroupId: 'uuid-cg', organizationId: 'org-1', tenantId: 'tenant-1' }
    const enrollment = { id: 'uuid-en', ...data }
    mockEm.create.mockReturnValue(enrollment)

    const result = await academicService.createEnrollment(data)

    expect(mockEm.create).toHaveBeenCalledWith(Enrollment, data)
    expect(result).toEqual(enrollment)
  })

  it('should find all enrollments with relations', async () => {
    const enrollments = [{ id: '1' }]
    mockEm.find.mockResolvedValue(enrollments)

    const result = await academicService.findAllEnrollments()

    expect(mockEm.find).toHaveBeenCalledWith(Enrollment, {}, { populate: ['trainee', 'classGroup', 'classGroup.course'] })
    expect(result).toEqual(enrollments)
  })
})
