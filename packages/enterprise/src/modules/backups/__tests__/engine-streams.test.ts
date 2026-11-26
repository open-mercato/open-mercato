import { PassThrough } from 'node:stream'
import { transform } from '../lib/engine/streams'

test('a paused byte-stream consumer keeps bounded prefetch and closes its owned producer',async()=>{
  let pulled=0,closed=false
  async function* source(){try{for(let index=0;index<32;index++){pulled++;yield Buffer.alloc(1024*1024,index)}}finally{closed=true}}
  const stream=transform(source(),new PassThrough({highWaterMark:1}))
  const first=await stream.next()
  expect(first.value?.byteLength).toBe(1024*1024)
  await new Promise(resolve=>setTimeout(resolve,25))
  expect(pulled).toBeLessThanOrEqual(3)
  await stream.return(undefined)
  expect(closed).toBe(true)
})
