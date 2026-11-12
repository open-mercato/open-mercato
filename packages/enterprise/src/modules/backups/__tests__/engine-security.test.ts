import { mkdtemp, chmod, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { contained, privateDirectory, readBoundedFile } from '../lib/engine/artifacts'
import { runBackupCli } from '../lib/engine/cli/main'
import { acquireBackupLock } from '../lib/engine/lock'
import { generateX25519Identity, identityToRecipient } from '../lib/engine/crypto'
import type { BackupSource } from '../lib/engine/types'
import { randomUUID } from 'node:crypto'

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
    expect(stderr).toEqual([])
  })
  test('environment enablement alone never establishes commercial rights',async () => {
    process.env.OM_ENABLE_ENTERPRISE_MODULES='true';process.env.OM_ENABLE_ENTERPRISE_MODULES_BACKUPS='true'
    const output:string[]=[]
    expect(await runBackupCli(['status',root],{stdout:()=>{},stderr:(text)=>output.push(text)})).toBe(3)
    expect(output.join('')).toContain('BACKUP_ENTERPRISE_RIGHTS_REQUIRED')
  })
  test('interrupted JSON creation preserves the durable run id and a safe exact CLI resume command', async () => {
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
    const exit=await runBackupCli(['create','--json','--progress','none','--source-service','fixture','--recipients-file',recipientsPath,'--output',join(root,'out'),'--workspace',join(root,'workspace')],{stdout:(text)=>output.push(text),stderr:()=>{},signal:controller.signal,sourceFactory:()=>source})
    const result=JSON.parse(output[0])
    expect(result.command).toBe('create');expect(result.runId).toBe(result.backupId)
    expect(exit).toBe(143);expect(result.status).toBe('interrupted');expect(result.backupId).toMatch(/^[a-f0-9-]{36}$/)
    expect(result.resumeCommand).toContain("'--source-service' 'fixture'")
    expect(result.resumeCommand).toContain("'--trusted-partial-sha256'")
    expect(result.partialStateSha256).toMatch(/^[a-f0-9]{64}$/)
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
  test('app wrapper refuses JSON rather than corrupting the standalone machine protocol',async () => {
    const output:string[]=[]
    expect(await runBackupCli(['status',root,'--json'],{stdout:(text)=>output.push(text),stderr:()=>{},appWrapper:true})).toBe(2)
    expect(JSON.parse(output[0]).error.code).toBe('BACKUP_USE_STANDALONE_FOR_JSON')
  })
})
