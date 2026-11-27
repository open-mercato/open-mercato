import { mkdtemp, chmod, mkdir, writeFile, readFile, readdir,rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { contained, privateDirectory, readBoundedFile } from '../lib/engine/artifacts'
import { runBackupCli } from '../lib/engine/cli/main'
import { acquireBackupLock } from '../lib/engine/lock'
import { generateX25519Identity, identityToRecipient } from '../lib/engine/crypto'
import type { BackupSource } from '../lib/engine/types'
import { randomUUID } from 'node:crypto'
import { BackupError } from '../lib/engine/errors'
import * as recoveryConfiguration from '../../../lib/recovery-configuration'

describe('recovery security boundary', () => {
  let root: string
  const rights = ['OM_ENABLE_ENTERPRISE_MODULES','OM_ENABLE_ENTERPRISE_MODULES_BACKUPS','OM_ENTERPRISE_COMMERCIAL_RIGHTS_ATTESTED'] as const
  const prior = new Map<string,string | undefined>()
  beforeEach(async () => {
    root=await mkdtemp(join(tmpdir(),'om-backup-security-')); await chmod(root,0o700)
    for (const key of rights) { prior.set(key,process.env[key]); delete process.env[key] }
  })
  afterEach(async () => {
    for (const key of rights) { const value=prior.get(key); if(value===undefined) delete process.env[key]; else process.env[key]=value }
    await rm(root,{recursive:true,force:true})
  })
  test('a live backup lock refuses another run and is released only by the owner',async () => {
    const path=join(root,'lock'); const release=await acquireBackupLock(path,randomUUID())
    await expect(acquireBackupLock(path,randomUUID())).rejects.toThrow('LIVE_LOCK')
    await release()
    const next=await acquireBackupLock(path,randomUUID()); await next()
  })
  test('artifact containment rejects parent traversal, absolute names and symlinked parent escape',async () => {
    await expect(contained(root,'../foreign')).rejects.toThrow('UNSAFE_PATH')
    await expect(contained(root,'/foreign')).rejects.toThrow('UNSAFE_PATH')
    await symlink(tmpdir(),join(root,'escape'))
    await expect(contained(root,'escape/foreign')).rejects.toThrow('UNSAFE_PATH')
  })
  test('private files reject public-readable data and bound bytes before full materialization',async () => {
    const path=join(root,'data');await writeFile(path,Buffer.alloc(100000),{mode:0o600})
    await expect(readBoundedFile(path,1024)).rejects.toThrow('RESOURCE_LIMIT')
    await chmod(path,0o644)
    await expect(readBoundedFile(path,100000)).rejects.toThrow('PRIVATE_FILE')
  })
  test('standalone JSON refusal is one object without secrets or application bootstrap',async () => {
    const stdout:string[]=[];const stderr:string[]=[]
    const code=await runBackupCli(['verify','--json','--artifact',root],{stdout:(text)=>stdout.push(text),stderr:(text)=>stderr.push(text)})
    expect(code).toBe(3);expect(stdout).toHaveLength(1);expect(JSON.parse(stdout[0])).toMatchObject({command:'verify',runId:expect.stringMatching(/^[a-f0-9-]{36}$/),status:'refused',error:{code:'BACKUP_ENTERPRISE_RIGHTS_REQUIRED'}})
    expect(stderr).toHaveLength(2); expect(stderr.every(line => line.includes('BACKUP_ENTERPRISE_RIGHTS_REQUIRED'))).toBe(true)
  })
  test('environment enablement alone never establishes commercial rights',async () => {
    process.env.OM_ENABLE_ENTERPRISE_MODULES='true';process.env.OM_ENABLE_ENTERPRISE_MODULES_BACKUPS='true'
    const output:string[]=[]
    expect(await runBackupCli(['status',root],{stdout:()=>{},stderr:(text)=>output.push(text)})).toBe(3)
    expect(output.join('')).toContain('BACKUP_ENTERPRISE_RIGHTS_REQUIRED')
  })
  test.each(['explicit', 'defaults'])('interrupted JSON creation preserves effective %s paths in its exact resume command', async mode => {
    for(const key of rights) process.env[key]='true'
    const identity=await generateX25519Identity()
    const recipientsPath=join(root,'recipients');await writeFile(recipientsPath,await identityToRecipient(identity),{mode:0o600})
    const controller=new AbortController()
    const source:BackupSource={async open(){return {
      identity:{clusterIncarnation:'fixture',databaseOid:'99',serverMajor:16,encoding:'UTF8',collation:'C'},
      evidence:{xmax:'999',xipList:[]},catalogDigest:'a'.repeat(64),migrationFingerprint:'b'.repeat(64),foreignKeys:[],
      entities:[{key:'e0001',schema:'public',table:'fixture',columns:['id'],label:'fixture',estimatedRows:'2',estimatedBytes:'20'}],
      async *schema(){yield Buffer.from('schema')},async *chunks(){
        yield {sequence:0,rows:'1',stream:(async function*(){yield Buffer.from('first')})()}
        controller.abort('SIGTERM')
        yield {sequence:1,rows:'1',stream:(async function*(){yield Buffer.from('second')})()}
      },async sequences(){return []},async boundary(){return {identity:{clusterIncarnation:'fixture',databaseOid:'99',serverMajor:16,encoding:'UTF8',collation:'C'},evidence:{xmax:'999',xipList:[]}}},async close(){}
    }},async close(){}}
    const output:string[]=[]
    const planned = await recoveryConfiguration.resolveRecoveryConfiguration({ overrides: { backupOutput: join(root,'out'), backupWorkspace: join(root,'workspace'), recipientsFile: recipientsPath, serviceFile: join(root,'service'), passwordFile: join(root,'password') }, discoverBinaries: false })
    planned.binaries = { directory: '/selected/postgresql17/bin', major: 17, source: 'platform-search' }
    planned.provenance.backupOutput = planned.provenance.backupWorkspace = planned.provenance.recipientsFile = 'platform-default'
    const resolver = mode === 'defaults' ? jest.spyOn(recoveryConfiguration, 'resolveRecoveryConfiguration').mockResolvedValue(planned) : undefined
    let exit: number
    try {
      exit=await runBackupCli(['create','--json','--progress','none','--source-service','fixture', ...(mode === 'explicit' ? ['--recipients-file',recipientsPath,'--output',join(root,'out'),'--workspace',join(root,'workspace')] : [])],{stdout:(text)=>output.push(text),stderr:()=>{},signal:controller.signal,sourceFactory:()=>source})
    } finally { resolver?.mockRestore() }
    const result=JSON.parse(output[0])
    expect(result.command).toBe('create');expect(result.runId).toBe(result.backupId)
    expect(exit).toBe(143);expect(result.status).toBe('interrupted');expect(result.backupId).toMatch(/^[a-f0-9-]{36}$/)
    expect(result.resumeCommand).toContain("'--source-service' 'fixture'")
    expect(result.resumeCommand).toContain("'--trusted-partial-sha256'")
    expect(result.partialStateSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.resumeCommand).toContain(`'--output' '${join(root,'out')}'`)
    expect(result.resumeCommand).toContain(`'--workspace' '${join(root,'workspace')}'`)
    expect(result.resumeCommand).toContain(`'--recipients-file' '${recipientsPath}'`)
    if (mode === 'defaults') {
      expect(result.resumeCommand).toContain("'--binaries-dir' '/selected/postgresql17/bin'")
      expect(result.resumeCommand).toContain(`PGSERVICEFILE='${join(root,'service')}' PGPASSFILE='${join(root,'password')}'`)
      expect(result.resumeCommand).not.toContain('--identity-file')
    }
  })
  test.each(['public-custody', 'symlink-base'])('implicit 0600 recipients refuse %s before opening source or creating artifacts', async unsafe => {
    for (const key of rights) process.env[key] = 'true'
    const priorRoot = process.env.OM_RECOVERY_ROOT
    // Exercise the private-ancestor guard outside forbidden temporary recovery roots,
    // including when Turbo's strict environment omits the host TMPDIR.
    const guardRoot = await mkdtemp(join(homedir(), '.om-backup-security-'))
    try {
      const actual = join(guardRoot, 'actual'), plannedRoot = unsafe === 'symlink-base' ? join(guardRoot, 'alias') : actual
      await mkdir(actual, { mode: 0o700 })
      await mkdir(join(actual, 'custody'), { mode: 0o700 })
      if (unsafe === 'symlink-base') await symlink(actual, plannedRoot)
      else await chmod(join(actual, 'custody'), 0o777)
      await writeFile(join(actual, 'custody', 'recipients.txt'), 'private-file-with-unsafe-ancestor', { mode: 0o600 })
      process.env.OM_RECOVERY_ROOT = plannedRoot
      const open = jest.fn(), sourceFactory = jest.fn(() => ({ open, close: jest.fn() }))
      const stdout: string[] = []
      expect(await runBackupCli(['create', '--source-service', 'fixture', '--json', '--progress', 'json'], { sourceFactory, stdout: value => stdout.push(value), stderr: () => {} })).toBe(3)
      expect(JSON.parse(stdout[0]).error.code).toBe('RECOVERY_PRIVATE_DIRECTORY_REQUIRED')
      expect(sourceFactory).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled()
      expect(await readdir(actual)).toEqual(['custody'])
    } finally {
      if (priorRoot === undefined) delete process.env.OM_RECOVERY_ROOT; else process.env.OM_RECOVERY_ROOT = priorRoot
      await rm(guardRoot, { recursive: true, force: true })
    }
  })
  test.each(['restore', 'exercise'])('%s checks only its actual durable workspace, not unused default output', async command => {
    for (const key of rights) process.env[key] = 'true'
    const identityFile = join(root, 'identity.txt')
    await writeFile(identityFile, await generateX25519Identity(), { mode: 0o600 })
    const plan = await recoveryConfiguration.resolveRecoveryConfiguration({ overrides: { backupWorkspace: join(root, 'workspace'), identityFile }, discoverBinaries: false })
    plan.container = true
    plan.durablePaths.backupOutput = plan.durablePaths.base = false
    plan.missingPrerequisites.push({ code: 'RECOVERY_PERSISTENT_MOUNT_REQUIRED', field: 'backupOutput' }, { code: 'RECOVERY_PERSISTENT_MOUNT_REQUIRED', field: 'base' })
    const resolver = jest.spyOn(recoveryConfiguration, 'resolveRecoveryConfiguration').mockResolvedValue(plan)
    const targetFactory = jest.fn(() => { throw new BackupError('FIXTURE_TARGET_BOUNDARY', 3) })
    const stdout: string[] = []
    try {
      expect(await runBackupCli([command, '--target-service', 'authorized-isolated-target', '--workspace', join(root, 'workspace'), '--identity-file', identityFile, '--artifact', join(root, 'artifact'), '--trusted-manifest-sha256', 'a'.repeat(64), '--confirm-target', 'fresh-fixture-challenge', '--json', '--progress', 'json'], { targetFactory, stdout: text => stdout.push(text), stderr: () => {} })).toBe(3)
      expect(targetFactory).toHaveBeenCalledWith(expect.objectContaining({ targetService: 'authorized-isolated-target', workspace: join(root, 'workspace') }))
      expect(JSON.parse(stdout[0]).error.code).toBe('FIXTURE_TARGET_BOUNDARY')
    } finally { resolver.mockRestore() }
  })
  test('invalid options preserve the requested single-object JSON error protocol',async()=>{
    const output:string[]=[]
    expect(await runBackupCli(['create','--json','--not-an-option'],{stdout:(text)=>output.push(text),stderr:()=>{}})).toBe(2)
    expect(output).toHaveLength(1);expect(JSON.parse(output[0])).toMatchObject({command:'create',runId:expect.stringMatching(/^[a-f0-9-]{36}$/)});expect(JSON.parse(output[0]).error.code).toBe('BACKUP_INVALID_INPUT')
  })
  test('successful standalone JSON stages have a command and operation run id',async()=>{
    const output:string[]=[]
    expect(await runBackupCli(['--help','--json'],{stdout:text=>output.push(text),stderr:()=>{}})).toBe(0)
    expect(output).toHaveLength(1)
    expect(JSON.parse(output[0])).toMatchObject({command:'help',runId:expect.stringMatching(/^[a-f0-9-]{36}$/),status:'completed'})
  })
  test('preflight operation selects a read-only source check and invalid operation/mode refuse',async()=>{
    for(const key of rights)process.env[key]='true'
    const close=jest.fn(async()=>{}),open=jest.fn(async()=>({identity:{clusterIncarnation:'fixture',databaseOid:'99',serverMajor:16,encoding:'UTF8',collation:'C'},entities:[],catalogDigest:'a'.repeat(64),close}))
    const output:string[]=[]
    expect(await runBackupCli(['preflight','--operation','create','--source-service','fixture','--report',join(root,'preflight-report.json'),'--json'],{stdout:text=>output.push(text),stderr:()=>{},sourceFactory:()=>({open,close} as unknown as BackupSource)})).toBe(0)
    expect(JSON.parse(output[0])).toMatchObject({command:'preflight',operation:'create',entityCount:0})
    expect(JSON.parse(await readFile(join(root,'preflight-report.json'),'utf8'))).toEqual(JSON.parse(output[0]))
    expect(close).toHaveBeenCalled();expect(open).toHaveBeenCalledTimes(1)
    expect(await runBackupCli(['preflight','--operation','unknown','--json'],{stdout:()=>{},stderr:()=>{}})).toBe(2)
    expect(await runBackupCli(['restore','--verify-mode','unknown','--json'],{stdout:()=>{},stderr:()=>{}})).toBe(2)
  })
  test('app wrapper refuses JSON rather than corrupting the standalone machine protocol',async () => {
    const output:string[]=[]
    expect(await runBackupCli(['status',root,'--json'],{stdout:(text)=>output.push(text),stderr:()=>{},appWrapper:true})).toBe(2)
    expect(JSON.parse(output[0]).error.code).toBe('BACKUP_USE_STANDALONE_FOR_JSON')
  })
})
