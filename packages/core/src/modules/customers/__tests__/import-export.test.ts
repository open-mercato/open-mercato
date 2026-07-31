import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import fs from 'fs'
import path from 'path'

// Mock container first
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

// Mock customFieldValues encryption module
jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => {
  return {
    resolveTenantEncryptionService: jest.fn(),
    encryptCustomFieldValue: jest.fn((val) => Promise.resolve(val)),
    decryptCustomFieldValue: jest.fn((val) => Promise.resolve(val)),
  }
})

import customersCliCommands from '../cli'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  resolveTenantEncryptionService,
  encryptCustomFieldValue,
  decryptCustomFieldValue,
} from '@open-mercato/shared/lib/encryption/customFieldValues'

const exportCustomersCommand = customersCliCommands.find((c) => c.command === 'customers:export')!
const importCustomersCommand = customersCliCommands.find((c) => c.command === 'customers:import')!

describe('customers import/export commands', () => {
  let mockDb: any
  let mockEm: any
  let mockContainer: any
  let mockEventBus: any
  let mockEncryptionService: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockEventBus = {
      emitEvent: (jest.fn() as any).mockResolvedValue(undefined),
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
      executeTakeFirst: jest.fn(),
      transaction: jest.fn().mockReturnThis(),
      insertInto: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      columns: jest.fn().mockReturnThis(),
      doUpdateSet: jest.fn().mockReturnThis(),
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

    ;(createRequestContainer as any).mockResolvedValue(mockContainer)

    mockEncryptionService = {
      isEnabled: jest.fn().mockReturnValue(true),
      encryptEntityPayload: jest.fn((entityId: string, payload: any) => {
        const encrypted = { ...payload }
        if (encrypted.display_name) encrypted.display_name = `[enc]${encrypted.display_name}`
        if (encrypted.legal_name) encrypted.legal_name = `[enc]${encrypted.legal_name}`
        if (encrypted.first_name) encrypted.first_name = `[enc]${encrypted.first_name}`
        return Promise.resolve(encrypted)
      }),
      decryptEntityPayload: jest.fn((entityId: string, payload: any) => {
        const decrypted = { ...payload }
        if (decrypted.display_name && decrypted.display_name.startsWith('[enc]')) {
          decrypted.display_name = decrypted.display_name.substring(5)
        }
        if (decrypted.legal_name && decrypted.legal_name.startsWith('[enc]')) {
          decrypted.legal_name = decrypted.legal_name.substring(5)
        }
        if (decrypted.first_name && decrypted.first_name.startsWith('[enc]')) {
          decrypted.first_name = decrypted.first_name.substring(5)
        }
        return Promise.resolve(decrypted)
      }),
    }

    ;(resolveTenantEncryptionService as any).mockReturnValue(mockEncryptionService)
    ;(encryptCustomFieldValue as any).mockImplementation((val: any) => Promise.resolve(`[enc]${val}`))
    ;(decryptCustomFieldValue as any).mockImplementation((val: any) => {
      if (typeof val === 'string' && val.startsWith('[enc]')) {
        return Promise.resolve(val.substring(5))
      }
      return Promise.resolve(val)
    })
  })

  it('exports customers to JSON format with decryption', async () => {
    const mockEntities = [
      {
        id: 'customer-1',
        display_name: '[enc]Jane Doe',
        kind: 'person',
        person_profile_id: 'person-profile-1',
        first_name: '[enc]Jane',
        last_name: 'Doe',
      },
      {
        id: 'customer-2',
        display_name: '[enc]ACME Corp',
        kind: 'company',
        company_profile_id: 'company-profile-2',
        legal_name: '[enc]ACME Corp LLC',
      },
    ]

    mockDb.execute
      .mockResolvedValueOnce(mockEntities) // first page of entities
      .mockResolvedValueOnce([ // custom field values
        {
          entity_id: 'customers:customer_company_profile',
          record_id: 'company-profile-2',
          field_key: 'custom_industry',
          value_text: '[enc]manufacture',
          value_multiline: null,
          value_int: null,
          value_float: null,
          value_bool: null,
        }
      ])
      .mockResolvedValueOnce([]) // end of pagination

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
      expect(parsed[1].customFields).toHaveLength(1)
      expect(parsed[1].customFields[0].key).toBe('custom_industry')
      expect(parsed[1].customFields[0].value).toBe('manufacture')
      expect(parsed[1].customFields[0].entityId).toBe('customers:customer_company_profile')
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    }
  })

  it('imports customers from JSON format with validation, indexing, and encryption', async () => {
    const mockData = [
      {
        id: '12345678-1234-4234-8234-123456789012',
        displayName: 'John Smith',
        kind: 'person',
        personProfile: {
          id: '87654321-4321-4321-8321-210987654321',
          firstName: 'John',
          lastName: 'Smith',
        },
        customFields: [
          {
            key: 'some_key',
            value: 'some_value',
            entityId: 'customers:customer_person_profile',
          }
        ],
      },
    ]

    const tempFile = path.resolve('./temp-import.json')
    fs.writeFileSync(tempFile, JSON.stringify(mockData), 'utf8')

    const mockTrx = {
      insertInto: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      columns: jest.fn().mockReturnThis(),
      doUpdateSet: jest.fn().mockReturnThis(),
      execute: (jest.fn() as any).mockResolvedValue(undefined),
    }

    mockDb.transaction = (jest.fn() as any).mockReturnValue({
      execute: (jest.fn() as any).mockImplementation((cb: any) => cb(mockTrx))
    })

    mockDb.executeTakeFirst.mockResolvedValue(null) // Mock company check & duplicate check

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
      expect(mockTrx.insertInto).toHaveBeenCalledWith('entity_indexes')

      expect(mockEncryptionService.encryptEntityPayload).toHaveBeenCalled()
      expect(encryptCustomFieldValue).toHaveBeenCalledWith('some_value', 'tenant-1', mockEncryptionService)

      expect(mockEventBus.emitEvent).toHaveBeenCalledWith('query_index.coverage.refresh', expect.objectContaining({
        tenantId: 'tenant-1',
      }))
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    }
  })

  it('handles invalid schema records and warnings safely', async () => {
    const mockData = [
      {
        id: 'invalid-uuid',
        displayName: 'John Doe',
        kind: 'person',
      },
      {
        id: '11111111-1111-4111-8111-111111111111',
        displayName: 'Jane Doe',
        kind: 'person',
        personProfile: {
          id: '22222222-2222-4222-8222-222222222222',
          firstName: 'Jane',
          companyEntityId: '33333333-3333-4333-8333-333333333333',
        }
      }
    ]

    const tempFile = path.resolve('./temp-import-warn.json')
    fs.writeFileSync(tempFile, JSON.stringify(mockData), 'utf8')

    const mockTrx = {
      insertInto: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      columns: jest.fn().mockReturnThis(),
      doUpdateSet: jest.fn().mockReturnThis(),
      execute: (jest.fn() as any).mockResolvedValue(undefined),
    }

    mockDb.transaction = (jest.fn() as any).mockReturnValue({
      execute: (jest.fn() as any).mockImplementation((cb: any) => cb(mockTrx))
    })

    mockDb.executeTakeFirst
      .mockResolvedValueOnce(null) // Jane Doe's duplicate check
      .mockResolvedValueOnce(null) // Referenced company check (returns null)

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await importCustomersCommand.run([
        '--tenant=tenant-1',
        '--org=org-1',
        '--format=json',
        `--input=${tempFile}`,
      ])

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[Record #1] Schema validation failed'), expect.any(String))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[Record #2] Warning: Referenced company ID 33333333-3333-4333-8333-333333333333 not found'))

      expect(mockTrx.insertInto).toHaveBeenCalledWith('customer_entities')
      expect(mockTrx.insertInto).toHaveBeenCalledWith('customer_people')
    } finally {
      warnSpy.mockRestore()
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    }
  })
})
