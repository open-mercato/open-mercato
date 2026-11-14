import { progressRenderer } from '../lib/engine/progress'
import type { ProgressEvent } from '../lib/engine/types'
const event:ProgressEvent={schemaVersion:1,type:'entity.progress',runId:'fixture',entity:'customers',rowsDone:'25',rowsTotal:'100',rowsTotalExact:false,bytesDone:'1048576',chunksDone:1,at:'2026-11-12T12:00:00Z'}
describe('operator progress protocol',()=>{
 let noColor: string | undefined, term: string | undefined
 beforeEach(()=>{noColor=process.env.NO_COLOR;term=process.env.TERM;delete process.env.NO_COLOR;process.env.TERM='xterm';jest.useFakeTimers();jest.setSystemTime(1000000)})
 afterEach(()=>{jest.useRealTimers();if(noColor===undefined)delete process.env.NO_COLOR;else process.env.NO_COLOR=noColor;if(term===undefined)delete process.env.TERM;else process.env.TERM=term})
 test('TTY exposes exact per-entity bar, throughput and ETA without terminal escapes from source labels',()=>{
  const output:string[]=[];const renderer=progressRenderer('tty',{isTTY:true,write:(text)=>{output.push(String(text));return true}})
  jest.advanceTimersByTime(1000);renderer({...event,rowsTotalExact:true,entity:'\u001b[31mcustomers\n'})
  expect(output[0]).toContain('████░░░░░░░░░░░░ 25%');expect(output[0]).toContain('25/100');expect(output[0]).toContain('1MiB/s ETA 3s')
  expect(output[0]).not.toContain('\u001b[31m');expect(output[0]).not.toContain('customers\n')
 })
 test('NDJSON is independently parseable and throttles progress but never drops completion',()=>{
  const output:string[]=[];const renderer=progressRenderer('json',{write:(text)=>{output.push(String(text));return true}})
  renderer(event);renderer(event);renderer({...event,type:'entity.done',rowsDone:'100',rowsTotalExact:true})
  expect(output.map((line)=>JSON.parse(line).type)).toEqual(['entity.progress','entity.done'])
 })
 test('TTY renders the aggregate bar alongside the current entity and finishes without leaving the cursor above it',()=>{
  const output:string[]=[];const render=progressRenderer('tty',{isTTY:true,write:(text)=>{output.push(String(text));return true}})
  render({...event,overallRowsDone:'25',overallRowsTotal:'200',overallRowsTotalExact:true})
  expect(output[0]).toContain('Overall');expect(output[0]).toContain('25/200');expect(output[0]).toContain('25/~100');expect(output[0]).toMatch(/\u001b\[\d+A/)
  render({...event,type:'run.finished',overallRowsDone:'200',overallRowsTotal:'200',overallRowsTotalExact:true})
  expect(output[1]).toContain('100% 200/200');expect(output[1]).toMatch(/\r\n$/)
 })
 test('none mode produces no progress output',()=>{
  const write=jest.fn(()=>true);progressRenderer('none',{write})(event);expect(write).not.toHaveBeenCalled()
 })
 test('TTY keeps eight independently keyed running entities visible beside queue and overall totals',()=>{
  let frame=''
  const render=progressRenderer('tty',{isTTY:true,columns:200,rows:24,write:text=>{frame=String(text);return true}})
  render({...event,type:'run.started',entity:undefined,overallRowsDone:'0',overallRowsTotal:'1200',entitiesTotal:12,entitiesDone:0,phase:'data'})
  for(let index=0;index<8;index++)render({...event,entityKey:`e${index}`,entity:`worker-${index}`,rowsDone:'0',bytesDone:'0',entitiesTotal:12,entitiesDone:0})
  expect(frame).toContain('8 running · 4 queued · 0 completed')
  for(let index=0;index<8;index++)expect(frame).toContain(`worker-${index}`)
  expect(frame).toContain('Overall');expect(frame).toContain('Phase: data')
  render({...event,type:'run.finished',entity:undefined,overallRowsDone:'1200',overallRowsTotal:'1200',overallRowsTotalExact:true,entitiesTotal:12,entitiesDone:12})
  expect(frame).toContain('0 running · 0 queued · 12 completed');expect(frame).toMatch(/\r\n$/)
 })
 test('TTY retains only three recent completions while still showing active entities',()=>{
  let frame=''
  const render=progressRenderer('tty',{isTTY:true,columns:200,rows:24,write:text=>{frame=String(text);return true}})
  render({...event,entityKey:'active',entity:'still-running',rowsDone:'0',bytesDone:'0',entitiesTotal:9,entitiesDone:0})
  for(let index=0;index<5;index++)render({...event,type:'entity.done',entityKey:`done-${index}`,entity:`completed-${index}`,rowsDone:'100',rowsTotalExact:true,entitiesTotal:9,entitiesDone:index+1})
  expect(frame).toContain('still-running');expect(frame).toContain('1 running · 3 queued · 5 completed')
  expect(frame).toContain('completed-4');expect(frame).toContain('completed-3');expect(frame).toContain('completed-2')
  expect(frame).not.toContain('completed-1');expect(frame).not.toContain('completed-0')
 })
 test('TTY adapts to terminal resize without wrapping hostile or wide labels and restores running rows when room returns',()=>{
  let frame=''
  const output={isTTY:true,columns:200,rows:24,write:(text:unknown)=>{frame=String(text);return true}}
  const render=progressRenderer('tty',output)
  for(let index=0;index<8;index++)render({...event,entityKey:`e${index}`,entity:`worker-${index}`,rowsDone:'0',bytesDone:'0'})
  output.rows=5;output.columns=40
  render({...event,type:'phase.changed',entity:undefined,phase:'data'})
  const visible=frame.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\r/g,'').split('\n')
  expect(visible.length).toBeLessThanOrEqual(4)
  expect(visible.every(line=>line.length<=39)).toBe(true)
  output.rows=24;output.columns=200
  for(let index=0;index<8;index++)render({...event,entityKey:`e${index}`,entity:`worker-${index}`,rowsDone:'0',bytesDone:'0'})
  render({...event,type:'entity.done',entityKey:'wide',entity:'漢字'.repeat(100)+'\u001b[31m\u001b]8;;https://unsafe.test\u0007\u202e\u061c\u2028',rowsDone:'100'})
  expect(frame).not.toContain('https://unsafe.test');expect(frame).not.toContain('\u001b[31m');expect(frame).not.toContain('\u202e');expect(frame).not.toContain('\u061c');expect(frame).not.toContain('\u2028')
  for(let index=0;index<8;index++)expect(frame).toContain(`worker-${index}`)
 })
 test('ten thousand completed entities keep the panel bounded and a long-running worker visible',()=>{
  let frame=''
  const render=progressRenderer('tty',{isTTY:true,columns:120,rows:24,write:text=>{frame=String(text);return true}})
  render({...event,entityKey:'long',entity:'long-running',rowsDone:'0',bytesDone:'0'})
  for(let index=0;index<10005;index++)render({...event,type:'entity.done',entityKey:`e${index}`,entity:`finished-${index}`,rowsDone:'100',entitiesTotal:10006,entitiesDone:index+1})
  expect(frame).toContain('long-running');expect(frame).toContain('1 running · 0 queued · 10005 completed')
  expect(frame).not.toContain('finished-0 ');expect(frame.length).toBeLessThan(2000)
 })
 test('JSON and plain modes retain independent records without terminal-panel control sequences',()=>{
  const json:string[]=[],plain:string[]=[]
  const jsonSink=progressRenderer('json',{write:text=>{json.push(String(text));return true}})
  const plainSink=progressRenderer('plain',{write:text=>{plain.push(String(text));return true}})
  for(const sink of [jsonSink,plainSink]){sink({...event,type:'run.started',entity:undefined});sink({...event,type:'entity.done',entityKey:'e1'})}
  expect(json.map(line=>JSON.parse(line).type)).toEqual(['run.started','entity.done'])
  expect(plain.join('')).not.toContain('\u001b[');expect(plain.join('')).not.toContain('queued')
 })

 test('a failed worker remains visible after peer completions and clears immediately when that worker retries',()=>{
  let frame=''
  const render=progressRenderer('tty',{isTTY:true,columns:200,rows:24,write:text=>{frame=String(text);return true}})
  render({...event,type:'entity.failed',entityKey:'failed',entity:'broken-entity',entitiesTotal:5,entitiesDone:0})
  for(let index=0;index<4;index++)render({...event,type:'entity.done',entityKey:`peer-${index}`,entity:`peer-${index}`,entitiesTotal:5,entitiesDone:index+1})
  expect(frame).toContain('broken-entity');expect(frame).toContain('1 failed');expect(frame).not.toContain('peer-0 ')
  render({...event,type:'entity.progress',entityKey:'failed',entity:'broken-entity',rowsDone:'0',bytesDone:'0',entitiesTotal:5,entitiesDone:4})
  expect(frame).toContain('1 running · 0 queued · 4 completed');expect(frame).not.toContain('1 failed')
 })
 test('ordinary phase changes retain completed entity history while a new baseline verification scan resets it',()=>{
  let frame=''
  const render=progressRenderer('tty',{isTTY:true,columns:200,rows:24,write:text=>{frame=String(text);return true}})
  render({...event,type:'entity.done',entityKey:'done',entity:'completed-data',phase:'data'})
  render({...event,type:'phase.changed',entity:undefined,phase:'post-data'})
  expect(frame).toContain('completed-data');expect(frame).toContain('Phase: post-data')
  render({...event,type:'run.started',entity:undefined,phase:'baseline'})
  render({...event,type:'entity.done',entityKey:'done',entity:'completed-baseline',phase:'baseline'})
  render({...event,type:'phase.changed',entity:undefined,phase:'verification'})
  expect(frame).not.toContain('completed-baseline');expect(frame).toContain('0 completed')
 })
 test('plain output shows every new worker state and timed aggregate lines without dropping starts',()=>{
  const lines:string[]=[]
  const render=progressRenderer('plain',{write:text=>{lines.push(String(text));return true}})
  const totals={overallRowsDone:'0',overallRowsTotal:'200',overallRowsTotalExact:true,entitiesTotal:2,entitiesDone:0}
  render({...event,...totals,type:'run.started',entity:undefined})
  render({...event,...totals,entityKey:'first',entity:'first',rowsDone:'0',bytesDone:'0'})
  render({...event,...totals,entityKey:'second',entity:'second',rowsDone:'0',bytesDone:'0'})
  expect(lines.filter(line=>line.startsWith('first:'))).toHaveLength(1)
  expect(lines.filter(line=>line.startsWith('second:'))).toHaveLength(1)
  render({...event,...totals,entityKey:'first',entity:'first',overallRowsDone:'25'})
  expect(lines.filter(line=>line.startsWith('first:'))).toHaveLength(1)
  jest.advanceTimersByTime(10000)
  render({...event,...totals,entityKey:'first',entity:'first',overallRowsDone:'50'})
  expect(lines.at(-1)).toContain('Overall: 50/200 rows · 0/2 completed')
  render({...event,...totals,type:'entity.done',entityKey:'first',entity:'first',rowsDone:'100',entitiesDone:1})
  expect(lines.at(-1)).toMatch(/^first:/)
  render({...event,...totals,type:'run.finished',entity:undefined,overallRowsDone:'200',entitiesDone:2})
  expect(lines.at(-1)).toContain('Overall: 200/200 rows · 2/2 completed')
  expect(lines.join('')).not.toContain('\u001b[')
 })


 test('estimated and unknown totals never imply exact percentages or ETA', () => {
 const lines:string[]=[]
 const render=progressRenderer('tty',{isTTY:true,columns:160,write:text=>{lines.push(String(text));return true}})
 for(const total of ['100','0'])render({...event,entityKey:`total-${total}`,rowsTotal:total,overallRowsDone:'25',overallRowsTotal:total,overallRowsTotalExact:false})
 expect(lines.join('')).not.toContain('%');expect(lines.join('')).not.toContain('ETA')
 expect(lines.join('')).toContain('25/~100');expect(lines.join('')).toContain('25/~0')
})

test.each(['NO_COLOR','dumb','pipe'])('%s output remains append-only ASCII status without cursor or color control', setting => {
 const lines:string[]=[]
 if(setting==='NO_COLOR')process.env.NO_COLOR=''
 if(setting==='dumb')process.env.TERM='dumb'
 const render=progressRenderer('tty',{isTTY:setting!=='pipe',write:text=>{lines.push(String(text));return true}})
 render(event);render({...event,type:'entity.done'});render.suspend()
 expect(lines.join('')).not.toContain('\u001b');expect(lines.join('')).not.toMatch(/[✅❌🔧]/u)
 delete process.env.NO_COLOR;process.env.TERM='xterm'
})

test('suspend closes only the owned panel before an external notice and resumes below it', () => {
 const lines:string[]=[]
 const render=progressRenderer('tty',{isTTY:true,write:text=>{lines.push(String(text));return true}})
 render({...event,overallRowsDone:'25',overallRowsTotal:'100',overallRowsTotalExact:true})
 render.suspend();lines.push('notice stays visible\n');render({...event,type:'entity.done',rowsTotalExact:true})
 expect(lines.join('')).not.toContain('\u001b[J')
 expect(lines[1]).toMatch(/\r\n$/);expect(lines[2]).toBe('notice stays visible\n')
 expect(lines[3]).not.toContain('\u001b[2K')
})

})
