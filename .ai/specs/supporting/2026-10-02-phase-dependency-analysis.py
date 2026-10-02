"""Assign every module file to a phase and prove no phase imports from a later one."""
import json, collections, re, sys
S='/tmp/claude-501/-Users-michalper-Projects-open-mercato/ab35cad2-47b1-4ab2-9452-6636a49cc50d/scratchpad'
mods=json.load(open(f'{S}/graph.json'))

# Ordered: the FIRST pattern that matches wins, so a later phase cannot claim an earlier phase's file.
RULES=[
 (1, r'^(data/entities|data/validators|data/|events|index|acl|di|setup|ce|encryption|i18n/)'),
 (1, r'^lib/(scope|queue|subscriber-forward|order-filter|html-escape|redact|external/|occurrence|runs|dispatcher|revisions|run-context|send-slots|sweep-interval|trigger-catalog|rate-limit|job-runs)'),
 (1, r'^lib/(engine/|canvas/|audience/|sweep-sources|preview)'),
 (1, r'^(commands/|migrations/)'),
 (1, r'^steps/(deps|add-tag|add-points|wait|split|assign-owner|issue-referral-code)'),
 (1, r'^(subscribers/|workers/)'),
 (1, r'^api/(shared|campaigns|readiness|settings|jobs|runs)'),
 (1, r'^backend/marketing/(campaigns|page|jobs|settings)'),

 (2, r'^lib/(tracking/|consent|preferences|content-blocks|deliverability|subject-document|render-values|interpolate|survey)'),
 (2, r'^steps/(send-email|nps-survey)'),
 (2, r'^api/(track|unsubscribe|survey|portal|consent|content-blocks)'),
 (2, r'^(frontend/|backend/marketing/content-blocks)'),

 (3, r'^lib/(analytics/|winner-metric|value-boundaries)'),
 (3, r'^api/campaigns/.*(results|analytics)'),
 (3, r'^backend/marketing/.*(results|analytics)'),

 (4, r'^lib/(segment|scores|score-rules|tiers|referrals|product-watches|lead-|recommendations|gdpr)'),
 (4, r'^api/(segments|scores|score-rules|referrals|product-watches|lead-routing|customers|tiers)'),
 (4, r'^backend/marketing/(segments|score-rules|scores|referrals|watches|leads)'),

 (5, r'^(ai-|lib/(ai-copy|inbound))'),
 (5, r'^api/(inbound|ai)'),
 (5, r'^backend/marketing/inbound-hooks'),
]
def phase(path):
    for ph, pat in RULES:
        if re.match(pat, path): return ph
    return None

assign={}
unmatched=[]
for p in mods:
    ph=phase(p)
    if ph is None: unmatched.append(p)
    else: assign[p]=ph

# Everything still unassigned lands in the phase of the LATEST thing it depends on,
# which is the earliest phase it could possibly ship in.
changed=True
while changed:
    changed=False
    for p in list(unmatched):
        deps=[assign.get(d) for d in mods[p]]
        if any(d is None for d in deps):
            continue
        assign[p]=max(deps, default=1) or 1
        unmatched.remove(p); changed=True

print(f'assigned: {len(assign)}  still unassigned: {len(unmatched)}')
if unmatched:
    print('  ' + ', '.join(sorted(unmatched)[:10]))

print('\nfiles per phase:')
for ph,c in sorted(collections.Counter(assign.values()).items()):
    print(f'  P{ph}: {c:4d}')

violations=[]
for src,deps in mods.items():
    if src not in assign: continue
    for dep in deps:
        if dep in assign and assign[dep] > assign[src]:
            violations.append((assign[src], src, assign[dep], dep))
print(f'\nback-edges (a phase importing from a LATER phase): {len(violations)}')
for a,s,b,d in sorted(violations)[:25]:
    print(f'  P{a} {s}  ->  P{b} {d}')
json.dump(assign, open(f'{S}/assign.json','w'))
