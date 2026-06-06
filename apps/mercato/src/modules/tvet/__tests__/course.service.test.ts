import { CourseService } from '../services/course.service'
import { Course } from '../data/entities'

describe('CourseService', () => {
  let courseService: CourseService
  let mockEm: any

  beforeEach(() => {
    mockEm = {
      create: jest.fn(),
      persist: jest.fn().mockReturnThis(),
      flush: jest.fn().mockResolvedValue(undefined),
      find: jest.fn(),
      findOne: jest.fn(),
    }
    courseService = new CourseService(mockEm)
  })

  it('should create a course', async () => {
    const data = {
      name: 'Information Technology',
      code: 'ICT001',
      level: 'Diploma',
      durationMonths: 24,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    }
    const course = { id: 'uuid-1', ...data }
    mockEm.create.mockReturnValue(course)

    const result = await courseService.create(data)

    expect(mockEm.create).toHaveBeenCalledWith(Course, data)
    expect(mockEm.persist).toHaveBeenCalledWith(course)
    expect(mockEm.flush).toHaveBeenCalled()
    expect(result).toEqual(course)
  })

  it('should find all courses', async () => {
    const courses = [{ id: '1' }, { id: '2' }]
    mockEm.find.mockResolvedValue(courses)

    const result = await courseService.findAll({ organizationId: 'org-1' })

    expect(mockEm.find).toHaveBeenCalledWith(Course, { organizationId: 'org-1' }, {})
    expect(result).toEqual(courses)
  })

  it('should find a course by id', async () => {
    const course = { id: 'uuid-1', name: 'IT' }
    mockEm.findOne.mockResolvedValue(course)

    const result = await courseService.findById('uuid-1', 'org-1', 'tenant-1')

    expect(mockEm.findOne).toHaveBeenCalledWith(Course, { id: 'uuid-1', organizationId: 'org-1', tenantId: 'tenant-1' })
    expect(result).toEqual(course)
  })

  it('should update a course', async () => {
    const course = { id: 'uuid-1', name: 'IT' }
    mockEm.findOne.mockResolvedValue(course)

    const result = await courseService.update('uuid-1', { name: 'CompSci' }, 'org-1', 'tenant-1')

    expect(course.name).toBe('CompSci')
    expect(mockEm.flush).toHaveBeenCalled()
    expect(result).toEqual(course)
  })

  it('should delete a course (soft delete)', async () => {
    const course = { id: 'uuid-1', deletedAt: null }
    mockEm.findOne.mockResolvedValue(course)

    const result = await courseService.delete('uuid-1', 'org-1', 'tenant-1')

    expect(course.deletedAt).toBeInstanceOf(Date)
    expect(mockEm.flush).toHaveBeenCalled()
    expect(result).toBe(true)
  })
})
