const BASE='http://127.0.0.1:46203'
const f=new URLSearchParams({email:'admin@acme.com',password:'secret'})
const token=(await (await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:f.toString()})).json()).token
const op=r=>{const h=r.headers.get('x-om-operation');if(!h)return null;try{return JSON.parse(decodeURIComponent(h.startsWith('omop:')?h.slice(5):h))}catch{return null}}
const api=async(m,p,d)=>{const r=await fetch(`${BASE}${p}`,{method:m,headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:d?JSON.stringify(d):undefined});let b=null;try{b=await r.json()}catch{};return{status:r.status,op:op(r),body:b}}
const undo=t=>api('POST','/api/audit_logs/audit-logs/actions/undo',{undoToken:t})
const idOf=b=>b?.id||b?.item?.id||b?.entityId
const s=Date.now()

console.log('=== §4 negative discrepancies (spec says NON-undoable -> expect NO token) ===')
// sales.returns.create
const ord=(await api('GET','/api/sales/orders?pageSize=3')).body?.items?.[0]
let rr=await api('POST','/api/sales/returns',{orderId:ord?.id, reason:'damaged', items:[]})
console.log('sales.returns.create        status',rr.status,'token?',!!rr.op, rr.op?'<-- DISCREPANCY (spec=non-undoable)':'(no token)', JSON.stringify(rr.body).slice(0,90))
// feature_toggles.overrides.changeState
let ov=await api('POST','/api/feature_toggles/overrides',{identifier:`x_${s}`,state:'enabled'})
console.log('feature_toggles.overrides   status',ov.status,'token?',!!ov.op, JSON.stringify(ov.body).slice(0,90))

console.log('\n=== X10 custom-field-heavy undo (product cf) ===')
// discover a product custom field
const cfDefs=await api('GET','/api/entities/custom-fields?entityId=catalog:product')
console.log('product cf endpoint status',cfDefs.status, Array.isArray(cfDefs.body?.items)?`${cfDefs.body.items.length} defs`:JSON.stringify(cfDefs.body).slice(0,80))

console.log('\n=== personCompanyLinks create -> undo ===')
const person=idOf((await api('POST','/api/customers/people',{firstName:'L',lastName:`${s}`,displayName:`L ${s}`})).body)
const company=idOf((await api('POST','/api/customers/companies',{displayName:`Co ${s}`})).body)
const link=await api('POST',`/api/customers/people/${person}/companies`,{companyId:company})
console.log('link create status',link.status,'token?',!!link.op)
const linksAfter=(await api('GET',`/api/customers/people/${person}/companies`)).body
const cnt=a=>Array.isArray(a?.items)?a.items.length:(Array.isArray(a)?a.length:'?')
if(link.op){await undo(link.op.undoToken);const after=(await api('GET',`/api/customers/people/${person}/companies`)).body;console.log('links after create:',cnt(linksAfter),'after undo:',cnt(after))}

console.log('\n=== dictionaryEntries create -> undo ===')
let de=await api('POST','/api/customers/dictionaries/source',{value:`undo_${s}`,label:`Undo Src ${s}`})
console.log('dict entry create status',de.status,'token?',!!de.op)
const deId=idOf(de.body)
if(de.op){await undo(de.op.undoToken);const list=(await api('GET','/api/customers/dictionaries/source')).body;const present=(list?.items||list||[]).some?.(x=>x.id===deId||x.value===`undo_${s}`);console.log('dict entry after undo present?',present,'(expect false)')}

console.log('\n=== sales.orders.lines.upsert -> undo (document line) ===')
if(ord?.id){const line=await api('POST',`/api/sales/orders/${ord.id}/lines`,{title:`Undo Line ${s}`,quantity:1,unitPriceNet:5})
 console.log('order line upsert status',line.status,'token?',!!line.op, JSON.stringify(line.body).slice(0,80))
 if(line.op){const u=await undo(line.op.undoToken);console.log('line undo status',u.status,JSON.stringify(u.body).slice(0,80))}}

console.log('\n=== planner.availability.weekly.replace -> undo ===')
const wk=await api('POST',`/api/planner/availability/weekly`,{subjectType:'resource',subjectId:idOf((await api('POST','/api/resources/resources',{name:`R ${s}`})).body),timezone:'UTC',days:{mon:[{start:'09:00',end:'17:00'}]}})
console.log('weekly.replace status',wk.status,'token?',!!wk.op, JSON.stringify(wk.body).slice(0,90))

// cleanup
await api('DELETE',`/api/customers/people?id=${person}`);await api('DELETE',`/api/customers/companies?id=${company}`)
