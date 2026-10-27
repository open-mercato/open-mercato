import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MetadataStorage } from '@mikro-orm/core'
import { OnboardingRequest } from '../modules/onboarding/data/entities'

type SnapshotIndex = {
  keyName: string
  columnNames: string[]
  unique: boolean
}

type SnapshotTable = {
  name: string
  indexes: SnapshotIndex[]
}

type Snapshot = {
  tables: SnapshotTable[]
}

function onboardingRequestUniqueProperties(): string[][] {
  const metadata = Object.values(MetadataStorage.getMetadata()).find(
    (candidate) => candidate.className === OnboardingRequest.name,
  )
  if (!metadata) throw new Error('[internal] OnboardingRequest decorator metadata was not registered')
  return metadata.uniques.map((unique) =>
    Array.isArray(unique.properties) ? [...unique.properties] : [String(unique.properties)],
  )
}

function onboardingRequestIndexProperties(): string[][] {
  const metadata = Object.values(MetadataStorage.getMetadata()).find(
    (candidate) => candidate.className === OnboardingRequest.name,
  )
  if (!metadata) throw new Error('[internal] OnboardingRequest decorator metadata was not registered')
  return metadata.indexes.map((index) =>
    Array.isArray(index.properties) ? [...index.properties] : [String(index.properties)],
  )
}

const migrationsDir = join(__dirname, '..', 'modules', 'onboarding', 'migrations')

function onboardingRequestSnapshotIndexes(): SnapshotIndex[] {
  const snapshotPath = join(migrationsDir, '.snapshot-open-mercato.json')
  const snapshot: Snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  const table = snapshot.tables.find((candidate) => candidate.name === 'onboarding_requests')
  if (!table) throw new Error('[internal] onboarding_requests is missing from the migration snapshot')
  return table.indexes
}

function onboardingMigrationSql(): string {
  return readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => readFileSync(join(migrationsDir, entry), 'utf8'))
    .join('\n')
}

describe('onboarding request email uniqueness', () => {
  it('does not declare a unique constraint on the non-deterministically encrypted email column', () => {
    expect(onboardingRequestUniqueProperties()).not.toContainEqual(['email'])
  })

  it('keeps emailHash as the deduplication contract', () => {
    expect(onboardingRequestUniqueProperties()).toContainEqual(['emailHash'])
  })

  it('keeps tokenHash unique so a token can only address one request', () => {
    expect(onboardingRequestUniqueProperties()).toContainEqual(['tokenHash'])
  })

  it('carries no unique index over email in the migration snapshot', () => {
    const uniqueColumns = onboardingRequestSnapshotIndexes()
      .filter((index) => index.unique)
      .map((index) => index.columnNames)
    expect(uniqueColumns).not.toContainEqual(['email'])
    expect(uniqueColumns).toContainEqual(['email_hash'])
  })

  it('keeps a non-unique index over email so the deduplication lookup stays indexable', () => {
    expect(onboardingRequestIndexProperties()).toContainEqual(['email'])
    const nonUniqueColumns = onboardingRequestSnapshotIndexes()
      .filter((index) => !index.unique)
      .map((index) => index.columnNames)
    expect(nonUniqueColumns).toContainEqual(['email'])
  })

  it('applies the same schema to a live database through the migrations', () => {
    const sql = onboardingMigrationSql()
    expect(sql).toContain('drop constraint if exists "onboarding_requests_email_unique"')
    expect(sql).toContain('create index if not exists "onboarding_requests_email_idx" on "onboarding_requests" ("email")')
  })
})
