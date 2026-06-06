import { TraineeService } from '../services/trainee.service'
import { Trainee } from '../data/entities'

describe('TraineeService', () => {
  let traineeService: TraineeService
  let mockEm: any

  beforeEach(() => {
    mockEm = {
      create: jest.fn(),
      persist: jest.fn().mockReturnThis(),
      flush: jest.fn().mockResolvedValue(undefined),
      find: jest.fn(),
      findOne: jest.fn(),
    }
    traineeService = new TraineeService(mockEm)
  })

  it('should create a trainee', async () => {
    const data = {
      name: 'John Doe',
      email: 'john@example.com',
      admissionNumber: 'ADM001',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    }
    const trainee = { id: 'uuid-1', ...data }
    mockEm.create.mockReturnValue(trainee)

    const result = await traineeService.create(data)

    expect(mockEm.create).toHaveBeenCalledWith(Trainee, data)
    expect(mockEm.persist).toHaveBeenCalledWith(trainee)
    expect(mockEm.flush).toHaveBeenCalled()
    expect(result).toEqual(trainee)
  })

  it('should find all trainees', async () => {
    const trainees = [{ id: '1' }, { id: '2' }]
    mockEm.find.mockResolvedValue(trainees)

    const result = await traineeService.findAll({ organizationId: 'org-1' })

    expect(mockEm.find).toHaveBeenCalledWith(Trainee, { organizationId: 'org-1' }, {})
    expect(result).toEqual(trainees)
  })

  it('should find a trainee by id', async () => {
    const trainee = { id: 'uuid-1', name: 'John' }
    mockEm.findOne.mockResolvedValue(trainee)

    const result = await traineeService.findById('uuid-1', 'org-1', 'tenant-1')

    expect(mockEm.findOne).toHaveBeenCalledWith(Trainee, { id: 'uuid-1', organizationId: 'org-1', tenantId: 'tenant-1' })
    expect(result).toEqual(trainee)
  })

  it('should update a trainee', async () => {
    const trainee = { id: 'uuid-1', name: 'John' }
    mockEm.findOne.mockResolvedValue(trainee)

    const result = await traineeService.update('uuid-1', { name: 'Johnny' }, 'org-1', 'tenant-1')

    expect(trainee.name).toBe('Johnny')
    expect(mockEm.flush).toHaveBeenCalled()
    expect(result).toEqual(trainee)
  })

  it('should delete a trainee (soft delete)', async () => {
    const trainee = { id: 'uuid-1', deletedAt: null }
    mockEm.findOne.mockResolvedValue(trainee)

    const result = await traineeService.delete('uuid-1', 'org-1', 'tenant-1')

    expect(trainee.deletedAt).toBeInstanceOf(Date)
    expect(mockEm.flush).toHaveBeenCalled()
    expect(result).toBe(true)
  })
})
