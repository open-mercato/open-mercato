import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertEphemeralDatabaseConnection,
  assertEphemeralDatabaseOwnership,
  readEphemeralDatabaseGuard,
  type EphemeralDatabaseGuard,
} from '../ephemeral-database-guard'

describe('ephemeral database initialization ownership', () => {
  const databaseUrl = 'postgresql://owned:private-password@127.0.0.1:6543/owned_database'
  const guard: EphemeralDatabaseGuard = {
    version: 1,
    databaseName: 'owned_database',
    connectionDigest: createHash('sha256').update(databaseUrl).digest('hex'),
    ownershipMarker: 'open-mercato-ephemeral:38ee43df-19e4-444e-b5c5-8e56b55c9d0c',
  }
  let directory: string
  let proofPath: string

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'ephemeral-db-guard-'))
    proofPath = path.join(directory, 'guard.json')
    writeFileSync(proofPath, JSON.stringify(guard), { mode: 0o600 })
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('keeps ordinary init compatible and reads the private argument proof', () => {
    expect(readEphemeralDatabaseGuard(['--reinstall'])).toBeNull()
    expect(readEphemeralDatabaseGuard([`--ephemeral-database-guard=${proofPath}`])).toEqual(guard)
  })

  it('rejects missing, duplicate, malformed and public proofs', () => {
    expect(() => readEphemeralDatabaseGuard(['--ephemeral-database-guard'])).toThrow('ownership proof file')
    expect(() => readEphemeralDatabaseGuard([`--ephemeral-database-guard=${proofPath}`, `--ephemeral-database-guard=${proofPath}`])).toThrow('ownership proof file')
    writeFileSync(proofPath, JSON.stringify({ ...guard, ownershipMarker: '' }))
    expect(() => readEphemeralDatabaseGuard([`--ephemeral-database-guard=${proofPath}`])).toThrow('proof is invalid')
    if (process.platform !== 'win32') {
      chmodSync(proofPath, 0o644)
      expect(() => readEphemeralDatabaseGuard([`--ephemeral-database-guard=${proofPath}`])).toThrow('private regular file')
    }
  })

  it('does not follow a replacement symlink', () => {
    const alias = path.join(directory, 'alias.json')
    symlinkSync(proofPath, alias)
    expect(() => readEphemeralDatabaseGuard([`--ephemeral-database-guard=${alias}`])).toThrow('private regular file')
  })

  it('rejects stripped or dotenv fallback destinations without exposing credentials', () => {
    expect(() => assertEphemeralDatabaseConnection(guard, undefined)).toThrow('explicit database connection')
    expect(() => assertEphemeralDatabaseConnection(guard, 'postgresql://fallback:other-secret@127.0.0.1:6544/control_database')).toThrow('not the owned disposable target')
    expect(() => assertEphemeralDatabaseConnection(guard, databaseUrl)).not.toThrow()
    try {
      assertEphemeralDatabaseConnection(guard, databaseUrl.replace('owned_database', 'wrong_database'))
    } catch (error) {
      expect(String(error)).not.toContain('private-password')
      expect(String(error)).not.toContain('wrong_database')
    }
  })

  it('reads the connected database identity and ownership marker before accepting it', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ database_name: guard.databaseName, ownership_marker: guard.ownershipMarker }] })
    await expect(assertEphemeralDatabaseOwnership(guard, { query })).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][0]).toMatch(/^SELECT current_database\(\)/)
  })

  it.each([
    { database_name: 'control_database', ownership_marker: guard.ownershipMarker },
    { database_name: guard.databaseName, ownership_marker: null },
    { database_name: guard.databaseName, ownership_marker: 'another-owner' },
  ])('refuses a connected database without matching positive ownership: %j', async (identity) => {
    const query = jest.fn().mockResolvedValue({ rows: [identity] })
    await expect(assertEphemeralDatabaseOwnership(guard, { query })).rejects.toThrow('ownership could not be verified')
    expect(query.mock.calls.every(([statement]) => String(statement).startsWith('SELECT'))).toBe(true)
  })
})
