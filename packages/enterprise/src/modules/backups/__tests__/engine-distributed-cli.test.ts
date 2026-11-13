/** @jest-environment node */
import { existsSync } from 'node:fs'
import { mkdtemp,readdir,rm } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
const packageRoot=resolve(__dirname,'../../../..')
const executable=join(packageRoot,'bin/mercato-backup.mjs')
// The configured gate builds packages first; a direct source-only unit run can omit dist.
const distribution=existsSync(join(packageRoot,'dist/modules/backups/lib/engine/cli/main.js'))?describe:describe.skip
distribution('built standalone CLI protocol (requires build:packages)',()=>{
 let directory:string
 beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'om-built-cli-protocol-'))})
 afterEach(async()=>{await rm(directory,{recursive:true,force:true})})
 test.each(['en','pl','de','es','ko'])('%s help runs outside an app and emits exactly one JSON object',async(locale)=>{
  const child=spawnSync(process.execPath,[executable,'--help','--json'],{cwd:directory,encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,LANG:locale,OM_LOG_DESTINATION:'stdout'}})
  expect(child.status).toBe(0);expect(child.stderr).toBe('')
  expect(child.stdout.trim().split('\n')).toHaveLength(1)
  expect(JSON.parse(child.stdout)).toMatchObject({command:'help',status:'completed',runId:expect.stringMatching(/^[a-f0-9-]{36}$/),help:expect.any(String)})
  expect(await readdir(directory)).toEqual([])
 })
 test.each(['development','production'])('%s failure preserves one stdout object and routes diagnostics to stderr',async(mode)=>{
  const child=spawnSync(process.execPath,[executable,'status',join(directory,'missing-artifact'),'--json'],{cwd:directory,encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,NODE_ENV:mode,OM_LOG_DESTINATION:'stdout',OM_ENABLE_ENTERPRISE_MODULES:'true',OM_ENABLE_ENTERPRISE_MODULES_BACKUPS:'true',OM_ENTERPRISE_COMMERCIAL_RIGHTS_ATTESTED:'true'}})
  expect(child.status).toBe(3)
  expect(child.stdout.trim().split('\n')).toHaveLength(1)
  expect(JSON.parse(child.stdout)).toMatchObject({command:'status',status:'refused',error:{code:'BACKUP_ARTIFACT_INVALID'}})
  expect(child.stderr).toContain('BACKUP_ARTIFACT_INVALID')
  expect(await readdir(directory)).toEqual([])
 })
})
