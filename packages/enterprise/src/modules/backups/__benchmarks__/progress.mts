/** Production renderer CPU replay: no database, credentials or filesystem mutations. */
import { progressRenderer } from '../lib/engine/progress'
import type { ProgressEvent } from '../lib/engine/types'
const referenceMs=Number(process.env.OM_BACKUP_PROGRESS_REFERENCE_MS)
if(!Number.isFinite(referenceMs)||referenceMs<=0)throw new Error('Supply measured backup elapsed milliseconds as OM_BACKUP_PROGRESS_REFERENCE_MS')
const results=[]
for(const mode of ['tty','plain','json','verbose','none'] as const){
 let outputBytes=0
 const render=progressRenderer(mode,{write(text){outputBytes+=Buffer.byteLength(String(text));return true}})
 const start=process.cpuUsage()
 for(let table=0;table<10000;table++)for(let chunk=1;chunk<=32;chunk++){
  const event:ProgressEvent={schemaVersion:1,type:chunk===32?'entity.done':'entity.progress',runId:'isolated-render-replay',entity:`protected entity ${table}`,rowsDone:String(chunk*100),rowsTotal:'3200',rowsTotalExact:true,bytesDone:String(chunk*65536),chunksDone:chunk,chunksTotal:32,at:'2026-11-12T00:00:00.000Z'}
  render(event)
 }
 const usage=process.cpuUsage(start),cpuMs=(usage.user+usage.system)/1000,percent=cpuMs/referenceMs*100
 results.push({mode,entities:10000,inputEvents:320000,outputBytes,cpuMs,referenceBackupMs:referenceMs,cpuPercentOfMeasuredBackup:percent,withinTwoPercent:percent<=2})
}
console.log(JSON.stringify({schemaVersion:1,scope:'renderer CPU with byte-counting output sink; excludes terminal device I/O',results}))
if(results.some(result=>!result.withinTwoPercent))process.exitCode=1
