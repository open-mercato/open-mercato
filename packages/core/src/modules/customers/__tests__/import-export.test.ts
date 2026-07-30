import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import fs from 'fs'
import path from 'path'
import customersCliCommands from '../cli'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

const exportCustomersCommand = customersCliCommands.find((c) => c.command === 'customers:export')!
const importCustomersCommand = customersCliCommands.find((c) => c.command === 'customers:import')!

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

describe('customers import/export commands', () => {
  let mockDb: any
  let mockEm: any
  let mockContainer: any
  let mockEventBus: any

  beforeEach(() => {
    mockEventBus = {
      emitEvent: jest.fn().mockResolvedValue(undefined),
    }

    mockDb = {
      selectFrom: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      execute: jest.fn(),
      transaction: jest.fn().mockReturnThis(),
      insertInto: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
    }

    mockEm = {
      getKysely: jest.fn().mockReturnValue(mockDb),
    }

    mockContainer = {
      resolve: jest.fn((name) => {
        if (name === 'em') return mockEm
        if (name === 'eventBus') return mockEventBus
        throw new Error(`mockContainer: Unknown dependency ${name}`)
      }),
    }

    ;(createRequestContainer as jest.Mock).mockResolvedValue(mockContainer)
  })

  it('exports customers to JSON format', async () => {
    const mockEntities = [
      {
        id: 'customer-1',
        display_name: 'Jane Doe',
        kind: 'person',
        first_name: 'Jane',
        last_name: 'Doe',
      },
      {
        id: 'customer-2',
        display_name: 'ACME Corp',
        kind: 'company',
        legal_name: 'ACME Corp LLC',
      },
    ]

    mockDb.execute
      .mockResolvedValueOnce(mockEntities) // first page
      .mockResolvedValueOnce([]) // second page
      .mockResolvedValueOnce([]) // custom fields

    const tempFile = path.resolve('./temp-export.json')
    
    try {
      await exportCustomersCommand.run([
        '--tenant=tenant-1',
        '--org=org-1',
        '--format=json',
        `--output=${tempFile}`,
      ])

      const content = fs.readFileSync(tempFile, 'utf8')
      const parsed = JSON.parse(content)

      expect(parsed).toHaveLength(2)
      expect(parsed[0].displayName).toBe('Jane Doe')
      expect(parsed[0].personProfile.firstName).toBe('Jane')
      expect(parsed[1].displayName).toBe('ACME Corp')
      expect(parsed[1].companyProfile.legalName).toBe('ACME Corp LLC')
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    }
  })

  it('exports customers to XML format', async () => {
    const mockEntities = [
      {
        id: 'customer-1',
        display_name: 'Jane Doe',
        kind: 'person',
        first_name: 'Jane',
        last_name: 'Doe',
      },
    ]

    mockDb.execute
      .mockResolvedValueOnce(mockEntities)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const tempFile = path.resolve('./temp-export.xml')
    
    try {
      await exportCustomersCommand.run([
        '--tenant=tenant-1',
        '--org=org-1',
        '--format=xml',
        `--output=${tempFile}`,
      ])

      const content = fs.readFileSync(tempFile, 'utf8')
      expect(content).toContain('<customers>')
      expect(content).toContain('<displayName>Jane Doe</displayName>')
      expect(content).toContain('</customers>')
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    }
  })

  it('imports customers from JSON format', async () => {
    const mockData = [
      {
        id: 'imported-1',
        displayName: 'John Smith',
        kind: 'person',
        personProfile: {
          firstName: 'John',
          lastName: 'Smith',
        },
        customFields: {
          some_key: 'some_value',
        },
      },
    ]

    const tempFile = path.resolve('./temp-import.json')
    fs.writeFileSync(tempFile, JSON.stringify(mockData), 'utf8')

    const mockTrx = {
      insertInto: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    }

    mockDb.transaction = jest.fn().mockReturnValue({
      execute: jest.fn().mockImplementation((cb: any) => cb(mockTrx))
    })

    try {
      await importCustomersCommand.run([
        '--tenant=tenant-1',
        '--org=org-1',
        '--format=json',
        `--input=${tempFile}`,
      ])

      expect(mockTrx.insertInto).toHaveBeenCalledWith('customer_entities')
      expect(mockTrx.insertInto).toHaveBeenCalledWith('customer_people')
      expect(mockTrx.insertInto).toHaveBeenCalledWith('custom_field_values')
      expect(mockEventBus.emitEvent).toHaveBeenCalled()
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    }
  })
})
