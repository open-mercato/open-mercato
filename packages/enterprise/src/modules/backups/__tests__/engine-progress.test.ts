import { progressRenderer } from '../lib/engine/progress'
import type { ProgressEvent } from '../lib/engine/types'
const event:ProgressEvent={schemaVersion:1,type:'entity.progress',runId:'fixture',entity:'customers',rowsDone:'25',rowsTotal:'100',rowsTotalExact:false,bytesDone:'1048576',chunksDone:1,at:'2026-11-12T12:00:00Z'}
describe('operator progress protocol',()=>{
 beforeEach(()=>{jest.useFakeTimers();jest.setSystemTime(1000000)})
 afterEach(()=>jest.useRealTimers())
 test('TTY exposes estimated per-entity bar, throughput and ETA without terminal escapes from source labels',()=>{
  const output:string[]=[];const renderer=progressRenderer('tty',{write:(text)=>{output.push(String(text));return true}})
  jest.advanceTimersByTime(1000);renderer({...event,entity:'\u001b[31mcustomers\n'})
  expect(output[0]).toContain('████░░░░░░░░░░░░ 25%');expect(output[0]).toContain('25/~100');expect(output[0]).toContain('1MiB/s ETA 3s')
  expect(output[0]).not.toContain('\u001b[31m');expect(output[0]).not.toContain('customers\n')
 })
 test('NDJSON is independently parseable and throttles progress but never drops completion',()=>{
  const output:string[]=[];const renderer=progressRenderer('json',{write:(text)=>{output.push(String(text));return true}})
  renderer(event);renderer(event);renderer({...event,type:'entity.done',rowsDone:'100',rowsTotalExact:true})
  expect(output.map((line)=>JSON.parse(line).type)).toEqual(['entity.progress','entity.done'])
 })
 test('none mode produces no progress output',()=>{
  const write=jest.fn(()=>true);progressRenderer('none',{write})(event);expect(write).not.toHaveBeenCalled()
 })
})
