export type ByteStream = AsyncIterable<Uint8Array>
export type DatabaseIdentity = {
  clusterIncarnation: string
  databaseOid: string
  serverMajor: number
  encoding: string
  collation: string
}
export type SnapshotEvidence = { xmax: string; xipList: string[] }
export type Entity = {
  copyFormat?: 'binary' | 'text'
  kind?: 'large-object'
  largeObjectOid?: string
  key: string
  schema: string
  table: string
  columns: string[]
  label: string
  estimatedRows: string
  estimatedBytes: string
  primaryKeys?: string[]
}
export type ForeignKey = { schema: string; table: string; name: string; definition: string }
export type SequenceState = { schema: string; name: string; value: string; isCalled: boolean; maxValue?: string }
export type SourceChunk = {
  sequence: number
  rows: string
  keyFrom?: string[]
  keyTo?: string[]
  stream: ByteStream
}
export type Snapshot = {
  identity: DatabaseIdentity
  evidence: SnapshotEvidence
  catalogDigest: string
  migrationFingerprint: string
  entities: Entity[]
  foreignKeys: ForeignKey[]
  boundary(): Promise<{ identity: DatabaseIdentity; evidence: SnapshotEvidence }>
  schema(section: 'pre-data' | 'post-data'): ByteStream
  chunks(entity: Entity, options: { chunkSizeBytes: number; after?: string[]; retainedRows?: string }): AsyncIterable<SourceChunk>
  sequences(): Promise<SequenceState[]>
  close(): Promise<void>
}
export type BackupSource = { open(): Promise<Snapshot>; close(): Promise<void> }
export type RestoreRun = { runId: string; backupId: string; manifestSha256: string; confirmation: string }
export type RestoreChunkWorker = Pick<RestoreTarget, 'chunk' | 'close'>
export type RestoreTarget = {
  preflightWorkers?(count: number): Promise<void>
  chunkWorkers?(count: number): Promise<RestoreChunkWorker[]>
  inspectResume?(run: RestoreRun): Promise<boolean>
  reportState?(): Promise<{ startedAt: string; resumeCount: number; resumeTimestamps?: string[] }>
  analyze?(): Promise<void>
  migrationFingerprint?(): Promise<string>
  readCanary?(entity: Entity, check: { field: string; key: Record<string, string> }): Promise<string>
  completeFromReport?(run: RestoreRun & { reportPath: string; targetIdentityDigest: string }): Promise<boolean>
  countRows(entity: Entity): Promise<string>
  identity(): Promise<DatabaseIdentity>
  challenge(binding: { backupId: string; manifestSha256: string; sourceIdentity: DatabaseIdentity }): Promise<string>
  initialize(run: RestoreRun): Promise<void>
  hasStep(stepId: string): Promise<boolean>
  schema(section: 'pre-data' | 'post-data', stream: ByteStream, stepId: string, workspace?: string): Promise<void>
  chunk(entity: Entity, stream: ByteStream, record: { runId: string; sequence: number; sha256: string; rows: string }): Promise<void>
  sequences(states: SequenceState[]): Promise<void>
  foreignKeys(keys: ForeignKey[]): Promise<void>
  finish(reportPath: string): Promise<void>
  close(): Promise<void>
}
export type NativeOptions = {
  workspace?: string
  maxStagingBytes?: number
  sourceService?: string
  targetService?: string
  binariesDir: string
  serviceFile: string
  passwordFile: string
  jobs?: number
  signal?: AbortSignal
  deadlineSeconds?: number
}
export type ProgressEvent = {
  schemaVersion: 1
  type: 'run.started' | 'entity.progress' | 'entity.done' | 'entity.failed' | 'phase.changed' | 'run.finished'
  runId: string
  entity?: string
  entityKey?: string
  entitiesTotal?: number
  entitiesDone?: number
  overallRowsDone?: string
  overallRowsTotal?: string
  overallRowsTotalExact?: boolean
  rowsDone: string
  rowsTotal: string
  rowsTotalExact: boolean
  bytesDone: string
  chunksDone: number
  chunksTotal?: number
  at: string
  phase?: string
}
export type ProgressSink = (event: ProgressEvent) => void
export type EngineContext = { signal?: AbortSignal; progress?: ProgressSink }
