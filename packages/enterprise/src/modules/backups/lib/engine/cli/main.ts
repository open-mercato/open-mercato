import { randomUUID } from 'node:crypto'
import { resolveRecoveryConfiguration, requireRecoveryDirectories, requireRecoveryCustodyFile, RecoveryConfigurationError, type RecoveryConfiguration, type RecoveryOverrides } from '@open-mercato/enterprise/lib/recovery-configuration'
import { parseArgs } from 'node:util'
import { createInterface } from 'node:readline/promises'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry/facade/report-error'
import { readFile,statfs,lstat } from 'node:fs/promises'
import { createPostgresSource, createPostgresTarget } from '../postgres'
import { createBackup } from '../create'
import { verifyBackup, readBackup } from '../verify'
import { restoreBackup } from '../restore'
import { exerciseBackup } from '../exercise'
import { preflightBackup } from '../preflight'
import { trustedPartialStatus } from '../partial-trust'
import { basename,dirname,isAbsolute,resolve } from 'node:path'
import { parseBooleanToken, parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { getBackupStatus } from '../status'
import { recipientsFromFile, identitiesFromFile } from '../crypto'
import { progressRenderer, type RenderedProgressSink } from '../progress'
import { createCliPresentation, type CliProgressMode } from '../cli-presentation'
import { BackupError, shellQuote } from '../errors'
import { readBoundedFile,privateDirectory,atomicStream } from '../artifacts'
import { bytes } from '../streams'
import { backupTranslation } from '../locale'
import type { NativeOptions, BackupSource, RestoreTarget, ProgressEvent } from '../types'

export async function runBackupCli(argv: string[], io: { stdout: (text: string) => void; stderr: (text: string) => void; appWrapper?: boolean; labels?: Record<string, string>; signal?: AbortSignal; sourceFactory?: (options: NativeOptions) => BackupSource; targetFactory?: (options: NativeOptions) => RestoreTarget } = { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) }): Promise<number> {
  const requestId=randomUUID()
  const terminalOutput = { write: (text: string | Uint8Array) => { io.stderr(String(text)); return true }, get isTTY() { return process.stderr.isTTY }, get columns() { return process.stderr.columns }, get rows() { return process.stderr.rows } }
  const progressArgument = argv.findIndex(value => value === '--progress')
  let structuredProgress = argv.includes('--progress=json') || (progressArgument >= 0 && argv[progressArgument + 1] === 'json')
  let render: RenderedProgressSink | undefined
  let presentation = createCliPresentation({ mode: structuredProgress ? 'json' : process.stderr.isTTY ? 'tty' : 'plain', output: terminalOutput, suspend: () => render?.suspend() })
  const startedAt = Date.now()
  let latestProgress: ProgressEvent | undefined
  const notice = (phase: string, text: string) => {
    render?.suspend()
    if (structuredProgress) io.stderr(JSON.stringify({ schemaVersion: 1, type: 'phase.changed', runId: latestProgress?.runId ?? requestId, phase, entity: text, rowsDone: '0', rowsTotal: '0', rowsTotalExact: false, bytesDone: '0', chunksDone: 0, at: new Date().toISOString() }) + '\n')
    else presentation.status('warn', text)
  }
  let configuration: RecoveryConfiguration | undefined
  const commands=['configure','preflight','create','status','verify','restore','exercise','help']
  let command=commands.includes(argv[0])?argv[0]:'unknown'
  let json = argv.includes('--json')
  const abort = new AbortController()
  const signal = io.signal ? AbortSignal.any([abort.signal, io.signal]) : abort.signal
  const onInterrupt = () => abort.abort('SIGINT')
  const onTerminate = () => abort.abort('SIGTERM')
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onTerminate)
  let timeout: NodeJS.Timeout | undefined
  try {
    const parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
      operation:{type:'string'},json: { type: 'boolean' }, help: { type: 'boolean' }, 'source-service': { type: 'string' }, 'target-service': { type: 'string' },
      output: { type: 'string' }, workspace: { type: 'string' }, artifact: { type: 'string' }, resume: { type: 'string' },
      'trusted-manifest-sha256': { type: 'string' }, 'confirm-target': { type: 'string' }, 'identity-file': { type: 'string' }, 'recipients-file': { type: 'string' },
      'no-encryption': { type: 'boolean' }, 'confirm-unencrypted': { type: 'boolean' }, quiesced: { type: 'boolean' },
      jobs: { type: 'string' }, 'chunk-size-bytes': { type: 'string' }, 'max-output-bytes': { type: 'string' }, 'max-staging-bytes': { type: 'string' },
      'deadline-seconds': { type: 'string' }, 'take-over-lock': { type: 'string' }, 'verify-mode': { type: 'string' },
      'checks-file': { type: 'string' }, 'canary-keys-file': { type: 'string' }, report: { type: 'string' }, progress: { type: 'string' }, 'binaries-dir': { type: 'string' }, 'trusted-partial-sha256': { type: 'string' }, 'labels-file': { type: 'string' },
    } })
    const values = parsed.values
    json = Boolean(values.json)
    const candidate=parsed.positionals[0]??'help'
    command=commands.includes(candidate)?candidate:'unknown'
    if (io.appWrapper && json) throw new BackupError('BACKUP_USE_STANDALONE_FOR_JSON', 2)
    if (values.help || command === 'help') {
      io.stdout(json ? JSON.stringify({ schemaVersion: 1, command: 'help', runId:requestId, status: 'completed', help: backupTranslation('backups.cli.help'), warnings: [] }) + '\n' : backupTranslation('backups.cli.help') + '\n')
      return 0
    }
    const configure = async () => {
      const overrides: RecoveryOverrides = {}
      if (values.output !== undefined) overrides.backupOutput = values.output
      if (values.workspace !== undefined) overrides.backupWorkspace = values.workspace
      if (values['binaries-dir'] !== undefined) overrides.binariesDir = values['binaries-dir']
      if (values['recipients-file'] !== undefined) overrides.recipientsFile = values['recipients-file']
      if (values['identity-file'] !== undefined) overrides.identityFile = values['identity-file']
      return resolveRecoveryConfiguration({ overrides, signal, discoverBinaries: command === 'configure' || !io.sourceFactory && !io.targetFactory })
    }
    if (io.appWrapper && json) throw new BackupError('BACKUP_USE_STANDALONE_FOR_JSON', 2)
    if (command === 'configure') {
      configuration = await configure()
      const mode = values.progress ?? (process.stderr.isTTY ? 'tty' : 'plain')
      if (!['tty', 'plain', 'json', 'verbose', 'none'].includes(mode)) throw new BackupError('BACKUP_INVALID_PROGRESS', 2)
      structuredProgress = mode === 'json'
      presentation = createCliPresentation({ mode: mode as CliProgressMode, output: terminalOutput })
      presentation.title(backupTranslation('backups.presentation.command.configure'))
      presentation.result(backupTranslation('backups.presentation.configurationPlan'), Object.entries(configuration.paths).map(([field, path]) => `${field}: ${path}`).concat(configuration.missingPrerequisites.map(item => `${item.code}: ${item.field}`)), configuration.missingPrerequisites.length ? 'warn' : 'ok')
      io.stdout(JSON.stringify({ schemaVersion: 1, command, runId: requestId, status: 'completed', assurance: 'configuration-plan-only', ...configuration, warnings: configuration.missingPrerequisites.map(item => item.code) }) + '\n')
      return 0
    }
    if (!parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES, false) || !parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES_BACKUPS, false) || !parseBooleanWithDefault(process.env.OM_ENTERPRISE_COMMERCIAL_RIGHTS_ATTESTED, false)) throw new BackupError('BACKUP_ENTERPRISE_RIGHTS_REQUIRED', 3)
    const resumeCommand = (name: string, id: string, partialDigest?: string): string => {
      const args = [name]
      const effective = { ...values, output: configuration?.paths.backupOutput ?? values.output, workspace: configuration?.paths.backupWorkspace ?? values.workspace, 'binaries-dir': configuration?.binaries.directory ?? values['binaries-dir'] }
      for (const [key, value] of Object.entries(effective)) {
        if (['resume', 'confirm-target', 'help', 'trusted-partial-sha256'].includes(key)) continue
        if (value === true) args.push(`--${key}`)
        else if (typeof value === 'string') args.push(`--${key}`, value)
      }
      args.push('--resume', id)
      if (name === 'create' && partialDigest) args.push('--trusted-partial-sha256', partialDigest)
      if (name === 'restore' || name === 'exercise') args.push('--confirm-target', '<fresh-confirmation-challenge>')
      const bindings = configuration ? `PGSERVICEFILE=${shellQuote(configuration.paths.serviceFile)} PGPASSFILE=${shellQuote(configuration.paths.passwordFile)} ` : ''
      return bindings + 'mercato-backup ' + args.map(shellQuote).join(' ')
    }
    const required = (key: keyof typeof values) => { const value = values[key] ?? (key === 'output' ? configuration?.paths.backupOutput : key === 'workspace' ? configuration?.paths.backupWorkspace : undefined); if (typeof value !== 'string' || !value) throw new BackupError('BACKUP_REQUIRED_OPTION', 2); return value }
    const number = (key: keyof typeof values, fallback: number) => { const value = values[key]; if (value === undefined) return fallback; if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new BackupError('BACKUP_INVALID_NUMBER', 2); const n = Number(value); if (!Number.isSafeInteger(n)) throw new BackupError('BACKUP_INVALID_NUMBER', 2); return n }
    if(typeof values.report==='string'){if(!isAbsolute(values.report))throw new BackupError('BACKUP_ABSOLUTE_PATH_REQUIRED',2);await privateDirectory(dirname(values.report));if(!['restore','exercise'].includes(command)&&await lstat(values.report).catch(()=>null))throw new BackupError('BACKUP_REPORT_ALREADY_EXISTS',3)}
    if(values['verify-mode']!==undefined&&!['full','streaming'].includes(values['verify-mode']))throw new BackupError('BACKUP_INVALID_VERIFY_MODE',2)
    const operation=values.operation??(values['target-service']?'restore':'create')
    if(values.operation!==undefined&&(command!=='preflight'||!['create','restore','exercise'].includes(operation)))throw new BackupError('BACKUP_INVALID_OPERATION',2)
    const jobs = number('jobs', 2)
    const deadline = number('deadline-seconds', 21600)
    if (jobs < 1 || jobs > 8 || deadline < 1 || deadline > 86400) throw new BackupError('BACKUP_INVALID_RESOURCE_OPTION', 2)
    timeout = setTimeout(() => abort.abort('deadline'), deadline * 1000); timeout.unref()
    configuration = await configure()
    const validDefaultFile = (field: 'recipientsFile' | 'identityFile') => {
      if (configuration!.missingPrerequisites.some(item => item.field === field)) return false
      requireRecoveryCustodyFile(configuration!, field)
      return true
    }
    if ((command === 'create' || command === 'status') && values['recipients-file'] === undefined && (configuration.provenance.recipientsFile !== 'platform-default' || validDefaultFile('recipientsFile'))) values['recipients-file'] = configuration.paths.recipientsFile
    if (values['identity-file'] === undefined && (['status', 'verify', 'restore', 'exercise'].includes(command) || values.resume !== undefined || command === 'preflight' && operation !== 'create') && (configuration.provenance.identityFile !== 'platform-default' || validDefaultFile('identityFile'))) values['identity-file'] = configuration.paths.identityFile
    if (['create', 'restore', 'exercise', 'verify'].includes(command)) requireRecoveryDirectories(configuration, ['backupWorkspace', ...(command === 'create' ? ['backupOutput'] as const : [])])
    for (const field of ['serviceFile', 'passwordFile'] as const) if (configuration.container && configuration.provenance[field] === 'platform-default' && !configuration.missingPrerequisites.some(item => item.field === field)) requireRecoveryCustodyFile(configuration, field)
    const selectedWorkspace = values.workspace ?? configuration.paths.backupWorkspace
    const native: NativeOptions = { sourceService: typeof values['source-service'] === 'string' ? values['source-service'] : undefined, targetService: typeof values['target-service'] === 'string' ? values['target-service'] : undefined, binariesDir: configuration.binaries.directory ?? values['binaries-dir'] ?? process.env.OM_BACKUP_BINARIES_DIR ?? '', serviceFile: configuration.paths.serviceFile, passwordFile: configuration.paths.passwordFile, jobs, signal: signal, deadlineSeconds: deadline, workspace: selectedWorkspace, maxStagingBytes: number('max-staging-bytes', 1024 * 1024 * 1024) }
    if (values['verify-mode'] && !['full', 'streaming'].includes(values['verify-mode'])) throw new BackupError('BACKUP_INVALID_VERIFY_MODE', 2)
    const progressMode = values.progress ?? (process.stderr.isTTY ? 'tty' : 'plain')
    if (!['tty', 'plain', 'json', 'verbose', 'none'].includes(String(progressMode))) throw new BackupError('BACKUP_INVALID_PROGRESS', 2)
    structuredProgress = progressMode === 'json'
    render = progressRenderer(progressMode as CliProgressMode, terminalOutput)
    presentation = createCliPresentation({ mode: progressMode as CliProgressMode, output: terminalOutput, suspend: () => render?.suspend() })
    const titles = { create: 'backups.presentation.command.create', verify: 'backups.presentation.command.verify', restore: 'backups.presentation.command.restore', exercise: 'backups.presentation.command.exercise', status: 'backups.presentation.command.status', preflight: 'backups.presentation.command.preflight' } as const
    const title = backupTranslation(titles[command as keyof typeof titles] ?? 'backups.cli.help')
    const totalSteps = command === 'restore' || command === 'exercise' ? 3 : command === 'create' || command === 'verify' ? 2 : 1
    let displayedStep = 1
    presentation.title(title)
    if (command !== 'status') presentation.step(1, totalSteps, backupTranslation('backups.presentation.phase.preflight'))
    const progress = (event: ProgressEvent) => {
      latestProgress = event
      if (displayedStep === 1 && event.type === 'run.started' && (command === 'create' || command === 'verify' || ((command === 'restore' || command === 'exercise') && event.phase !== 'verify'))) {
        presentation.status('ok', backupTranslation('backups.presentation.phase.preflight'))
        displayedStep = 2
        presentation.step(2, totalSteps, backupTranslation(command === 'create' ? 'backups.presentation.phase.create' : command === 'verify' ? 'backups.presentation.phase.verify' : 'backups.presentation.phase.restore'))
      }
      if (displayedStep === 2 && totalSteps === 3 && event.type === 'entity.done' && event.entitiesTotal !== undefined && event.entitiesDone === event.entitiesTotal) {
        displayedStep = 3
        presentation.step(3, 3, backupTranslation('backups.presentation.phase.checks'))
      }
      render!(event)
    }
    const artifact = typeof values.artifact === 'string' ? values.artifact : parsed.positionals[1]
    const identities = typeof values['identity-file'] === 'string' ? await identitiesFromFile(values['identity-file']) : []
    let result: unknown
    if (command === 'status') {
      if (!artifact) throw new BackupError('BACKUP_REQUIRED_ARTIFACT', 2)
      const partialId = /^\.([a-f0-9-]{36})\.partial$/.exec(basename(artifact))?.[1]
      const defaultRunIdentity = partialId ? await lstat(resolve(selectedWorkspace, `${partialId}.identity`)).catch(() => undefined) : undefined
      const statusWorkspace = values.workspace ?? (defaultRunIdentity ? selectedWorkspace : undefined)
      if (statusWorkspace) requireRecoveryDirectories(configuration, ['backupWorkspace'])
      result = await getBackupStatus(artifact,{identities,workspace:statusWorkspace,identityFile:typeof values['identity-file']==='string'?values['identity-file']:undefined,sourceService:native.sourceService,recipientsFile:typeof values['recipients-file']==='string'?values['recipients-file']:undefined,trustedManifestSha256:typeof values['trusted-manifest-sha256']==='string'?values['trusted-manifest-sha256']:undefined})
      if (typeof statusWorkspace === 'string' && basename(artifact).endsWith('.partial')) result = { ...result as object, ...await trustedPartialStatus(artifact, statusWorkspace, basename(artifact).slice(1,-8)) }
      if (result && typeof result === 'object' && 'resumeCommand' in result && typeof result.resumeCommand === 'string') result.resumeCommand = `PGSERVICEFILE=${shellQuote(configuration.paths.serviceFile)} PGPASSFILE=${shellQuote(configuration.paths.passwordFile)} ` + result.resumeCommand + (configuration.binaries.directory ? ` '--binaries-dir' ${shellQuote(configuration.binaries.directory)}` : '')
    } else if (command === 'verify') {
      if (!artifact) throw new BackupError('BACKUP_REQUIRED_ARTIFACT', 2)
      if (values.workspace === undefined) await privateDirectory(selectedWorkspace, true)
      const verified = await verifyBackup({ artifact, trustedManifestSha256: required('trusted-manifest-sha256'), identities, signal: signal, progress, binariesDir: native.binariesDir, workspace: selectedWorkspace, maxStagingBytes: native.maxStagingBytes })
      result = { backupId: verified.manifest.backupId, consistency: verified.index.consistency, encryption: verified.manifest.encryption.mode }
    } else if (command === 'preflight') {
      if(operation==='restore'||operation==='exercise'){
        required('target-service');if(!artifact)throw new BackupError('BACKUP_REQUIRED_ARTIFACT',2)
        const target = (io.targetFactory ?? createPostgresTarget)(native)
        try {
          await target.preflightWorkers?.(jobs)
          const backup = await readBackup({ artifact, trustedManifestSha256: required('trusted-manifest-sha256'), identities })
          result = { confirmationChallenge: await target.challenge({ backupId: backup.manifest.backupId, manifestSha256: required('trusted-manifest-sha256'), sourceIdentity: backup.index.identity }), targetIdentity: await target.identity() }
        } finally { await target.close() }
      } else {required('source-service');
        for(const key of ['workspace','output'] as const)if(typeof values[key]==='string'){if(!isAbsolute(values[key]))throw new BackupError('BACKUP_ABSOLUTE_PATH_REQUIRED',2);await privateDirectory(values[key]);const disk=await statfs(values[key],{bigint:true});if(disk.bavail*disk.bsize<1024n*1024n*1024n)throw new BackupError('BACKUP_DISK_RESERVE',3)}
        if(values['no-encryption']&&(process.env.OM_BACKUP_REQUIRE_ENCRYPTION!==undefined&&parseBooleanToken(process.env.OM_BACKUP_REQUIRE_ENCRYPTION)!==false))throw new BackupError('BACKUP_UNENCRYPTED_REFUSED',3)
        const recipientsFile=typeof values['recipients-file']==='string'?values['recipients-file']:process.env.OM_BACKUP_RECIPIENTS_FILE
        if(recipientsFile)await recipientsFromFile(recipientsFile)
        result = await preflightBackup((io.sourceFactory ?? createPostgresSource)(native))}
      result={...result as object,operation}
    } else if (command === 'create') {
      const recipientsFile = typeof values['recipients-file'] === 'string' ? values['recipients-file'] : process.env.OM_BACKUP_RECIPIENTS_FILE
      const recipients = recipientsFile ? await recipientsFromFile(recipientsFile) : []
      const labels = typeof values['labels-file'] === 'string' ? JSON.parse((await readBoundedFile(values['labels-file'], 64 * 1024 * 1024)).toString()) as Record<string, string> : io.labels
      if (labels && (Object.keys(labels).length > 100000 || Object.values(labels).some((value) => typeof value !== 'string' || value.length > 4096))) throw new BackupError('BACKUP_INVALID_LABELS', 2)
      let confirmUnencrypted = Boolean(values['confirm-unencrypted'])
      if (values['no-encryption'] && !confirmUnencrypted && process.stdin.isTTY && !structuredProgress) {
        render?.suspend()
        const prompt = createInterface({ input: process.stdin, output: process.stderr })
        try { confirmUnencrypted = await prompt.question(backupTranslation('backups.cli.unencryptedPrompt'), { signal: signal }) === 'UNENCRYPTED' } finally { prompt.close() }
      }
      if (values['no-encryption'] && confirmUnencrypted) notice('backup.warning.unencrypted', backupTranslation('backups.cli.unencrypted'))
      let createResume=typeof values.resume==='string'?values.resume:undefined
      if(createResume&&!/^[a-f0-9-]{36}$/.test(createResume)){const path=resolve(createResume),id=/^\.([a-f0-9-]{36})\.partial$/.exec(basename(path))?.[1];if(!id||resolve(required('output'))!==dirname(path))throw new BackupError('BACKUP_RESUME_PATH_MISMATCH',2);createResume=id}
      result = await createBackup({ source: (io.sourceFactory ?? createPostgresSource)(native), output: required('output'), workspace: required('workspace'), recipients, labels, jobs, resumeCommand: (id, digest) => resumeCommand('create', id, digest), noEncryption: values['no-encryption']===undefined?undefined:Boolean(values['no-encryption']), confirmUnencrypted, requireEncryption: process.env.OM_BACKUP_REQUIRE_ENCRYPTION === undefined ? false : parseBooleanToken(process.env.OM_BACKUP_REQUIRE_ENCRYPTION) !== false, chunkSizeBytes: values['chunk-size-bytes']===undefined?undefined:number('chunk-size-bytes',64*1024*1024), maxOutputBytes: values['max-output-bytes'] === undefined ? undefined : number('max-output-bytes', 0), resume:createResume, quiesced: Boolean(values.quiesced), identities, trustedPartialSha256: typeof values['trusted-partial-sha256'] === 'string' ? values['trusted-partial-sha256'] : undefined, takeOverLock: typeof values['take-over-lock'] === 'string' ? values['take-over-lock'] : undefined, progress, signal: signal })
    } else if (command === 'restore' || command === 'exercise') {
      if (!artifact) throw new BackupError('BACKUP_REQUIRED_ARTIFACT', 2)
      const target = (io.targetFactory ?? createPostgresTarget)(native)
      const shared = { artifact, binariesDir: native.binariesDir, resumeCommand: (id: string) => resumeCommand(command, id), trustedManifestSha256: required('trusted-manifest-sha256'), identities, target, jobs, workspace: required('workspace'), confirmation: required('confirm-target'), resume: typeof values.resume === 'string' ? values.resume : undefined, verifyMode: values['verify-mode'] === 'streaming' ? 'streaming' as const : 'full' as const, maxStagingBytes: number('max-staging-bytes', 1024 * 1024 * 1024), reportPath: typeof values.report === 'string' ? values.report : undefined, signal: signal, progress }
      result = command === 'exercise' ? await exerciseBackup({ ...shared, checksFile: required('checks-file'), canaryKeysFile: typeof values['canary-keys-file'] === 'string' ? values['canary-keys-file'] : undefined }) : await restoreBackup(shared)
    } else throw new BackupError('BACKUP_UNKNOWN_COMMAND', 2)
    const unencrypted = result && typeof result === 'object' && 'encryption' in result && result.encryption === 'none'
    const identifiers=result as {restoreRunId?:string;backupId?:string}
    const output={ schemaVersion: 1, command, status: 'completed', warnings: unencrypted ? ['UNENCRYPTED'] : [], ...result as object,runId:identifiers.restoreRunId??identifiers.backupId??requestId }
    if(typeof values.report==='string'&&!['restore','exercise'].includes(command))await atomicStream(values.report,bytes(Buffer.from(JSON.stringify(output))))
    render?.suspend()
    const details = result && typeof result === 'object' ? result as Record<string, unknown> : {}
    const lines: string[] = []
    const detail = (key: Parameters<typeof backupTranslation>[0], value: unknown) => { if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') lines.push(`${backupTranslation(key)}: ${String(value)}`) }
    detail('backups.presentation.label.run', output.runId)
    detail('backups.presentation.label.backup', details.backupId)
    detail('backups.presentation.label.state', details.status ?? 'completed')
    detail('backups.presentation.label.artifact', details.artifactPath ?? artifact)
    detail('backups.presentation.label.report', details.reportPath ?? values.report)
    detail('backups.presentation.label.encryption', details.encryption)
    detail('backups.presentation.label.consistency', details.consistency)
    detail('backups.presentation.label.rows', latestProgress?.overallRowsDone ?? latestProgress?.rowsDone)
    detail('backups.presentation.label.chunks', details.chunkCount ?? latestProgress?.chunksDone)
    if (typeof details.entitiesDone === 'number' && typeof details.entitiesTotal === 'number') lines.push(`${details.entitiesDone}/${details.entitiesTotal} ${backupTranslation('backups.progress.completed')}`)
    if (command === 'verify' || command === 'restore' || command === 'exercise') detail('backups.presentation.label.verification', backupTranslation(command !== 'verify' && values['verify-mode'] === 'streaming' ? 'backups.presentation.verification.streaming' : 'backups.presentation.verification.full'))
    if (details.targetIdentity && typeof details.targetIdentity === 'object') detail('backups.presentation.label.target', JSON.stringify(details.targetIdentity))
    detail('backups.presentation.label.confirmation', details.confirmationChallenge)
    detail('backups.presentation.label.elapsed', `${Math.round((Date.now() - startedAt) / 1000)}s`)
    const assurance = command === 'create' ? 'backups.presentation.assurance.created' : command === 'verify' ? 'backups.presentation.assurance.verified' : command === 'restore' ? 'backups.presentation.assurance.quarantined' : command === 'exercise' ? 'backups.presentation.assurance.exercise' : command === 'status' ? 'backups.presentation.assurance.status' : 'backups.presentation.verification.metadata'
    lines.push(backupTranslation(assurance))
    if (typeof details.resumeCommand === 'string') lines.push(`${backupTranslation('backups.presentation.label.resume')}: ${details.resumeCommand}`)
    presentation.result(`${title} · ${backupTranslation(details.status === 'resumable' ? 'backups.presentation.resumable' : 'backups.presentation.completed')}`, lines, details.status === 'resumable' || unencrypted ? 'warn' : 'ok')
    io.stdout(JSON.stringify(output)+'\n')
    return 0
  } catch (error) {
    const inputFailure = error && typeof error === 'object' && (('code' in error && String(error.code).startsWith('ERR_PARSE_ARGS')) || ('name' in error && ['ZodError', 'SyntaxError'].includes(String(error.name))))
    const failure = signal.aborted ? new BackupError(signal.reason === 'deadline' ? 'BACKUP_DEADLINE' : 'BACKUP_INTERRUPTED', signal.reason === 'SIGTERM' ? 143 : signal.reason === 'deadline' ? 5 : 130, true) : error instanceof RecoveryConfigurationError ? new BackupError(error.code, error.code.includes('INVALID') || error.code.includes('UNSUPPORTED') ? 2 : 3) : error instanceof BackupError ? error : inputFailure ? new BackupError('BACKUP_INVALID_INPUT',2) : new BackupError('BACKUP_INVALID_INPUT_OR_FAILURE', 1)
    if (error instanceof BackupError && signal.aborted) failure.context = error.context
    render?.suspend()
    const output = { schemaVersion: 1, command,runId:failure.context.restoreRunId??failure.context.backupId??requestId,status: [130, 143].includes(failure.exitCode) ? 'interrupted' : failure.resumable ? 'resumable' : failure.exitCode === 2 || failure.exitCode === 3 ? 'refused' : 'failed', error: { code: failure.code, messageKey: 'backups.cli.error' }, warnings: [], ...failure.context }
    const errorText = `${backupTranslation('backups.cli.error')} ${failure.code}`
    const presentFailure = (namespace: 'backups' | 'telemetry', warning: boolean) => {
      if (structuredProgress) notice(warning ? 'backup.telemetry.warning' : namespace === 'backups' ? `backup.command.${output.status}` : `backup.${output.status}`, `${errorText}${failure.context.resumeCommand ? '\n' + failure.context.resumeCommand : ''}`)
      else presentation.notice(`${namespace}: ${errorText}`)
    }
    const commandLogger = createLogger('backups', { write: () => presentFailure('backups', false) })
    commandLogger.error('[internal] Backup command failed', { code: failure.code })
    const telemetryLogger = createLogger('telemetry', { write: record => presentFailure('telemetry', record.level === 'warn') })
    reportError(new Error(`[internal] ${failure.code}`), { module: 'backups', code: 'backups.command_failed', attributes: { failure_code: failure.code }, logger: telemetryLogger })
    if (json) io.stdout(JSON.stringify(output) + '\n')
    if (!structuredProgress && !json) {
      const lines: string[] = []
      if (failure.resumable && failure.context.resumeCommand) {
        lines.push(backupTranslation('backups.presentation.assurance.incomplete'))
        if (command === 'restore' || command === 'exercise') lines.push(backupTranslation('backups.presentation.assurance.freshConfirmation'))
        lines.push(`${backupTranslation('backups.presentation.label.resume')}: ${failure.context.resumeCommand}`)
        presentation.result(`${backupTranslation('backups.presentation.resumable')} · ${failure.code}`, lines, 'warn')
      } else presentation.error(errorText, lines)
    }
    return failure.exitCode
  } finally {
    render?.suspend()
    if (timeout) clearTimeout(timeout)
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onTerminate)
  }
}
