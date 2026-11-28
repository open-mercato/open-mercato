import json,subprocess,sys,time
container,root,destination=sys.argv[1:]
peak=0;peak_node=0;samples=0;children=0;seen=False;missing=0;deadline=time.monotonic()+21600
while time.monotonic()<deadline:
 out=subprocess.check_output(['docker','exec',container,'ps','-eo','pid,ppid,rss,args'],text=True)
 rows=[]
 for line in out.splitlines()[1:]:
  parts=line.strip().split(None,3)
  if len(parts)==4:rows.append((int(parts[0]),int(parts[1]),int(parts[2]),parts[3]))
 selected=[r for r in rows if 'node ' in r[3] and '/bench/rotation.mjs' in r[3] and root in r[3]]
 if selected:
  seen=True;missing=0;pids={r[0] for r in selected};previous=set()
  while pids!=previous:
   previous=set(pids);pids.update(r[0] for r in rows if r[1] in pids)
  peak=max(peak,sum(r[2] for r in rows if r[0] in pids));peak_node=max(peak_node,max(r[2] for r in selected));children=max(children,len(pids)-len(selected));samples+=1
 elif seen:
  missing+=1
  if missing>=3:break
 time.sleep(.1)
complete=seen and missing>=3
record={'complete':complete,'peakProcessTreeRssMiB':peak/1024,'peakNodeRssMiB':peak_node/1024,'totalProcessTreePass':complete and peak<=512*1024,'samplingIntervalMs':100,'samples':samples,'maximumNativeDescendants':children,'definition':'sum resident RSS of benchmark Node process and all native descendants, excluding PostgreSQL server daemon; sampled with ps'}
with open(destination,'w') as output:json.dump(record,output,indent=2)
print(json.dumps(record))
