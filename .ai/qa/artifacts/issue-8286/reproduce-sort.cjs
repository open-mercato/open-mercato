const fs = require('node:fs')
const cp = require('node:child_process')
const ts = require(process.cwd() + '/node_modules/typescript-js')
const filename = 'packages/core/src/modules/customers/components/detail/ActivitiesSection.tsx'
const fixtures = [
  { id: 'undated-a', occurredAt: null, scheduledAt: null, createdAt: '2035-01-01T00:00:00Z', status: 'done' },
  { id: 'dated', occurredAt: '2020-01-01T00:00:00Z', scheduledAt: null, createdAt: '2020-01-01T00:00:00Z', status: 'done' },
  { id: 'undated-z', occurredAt: null, scheduledAt: null, createdAt: '2010-01-01T00:00:00Z', status: 'done' },
]
for (const [label, source] of [['base', cp.execFileSync('git', ['show', '9234230c720297e4ccdde022632004f3844cb34c:' + filename], { encoding: 'utf8' })], ['fixed', fs.readFileSync(filename, 'utf8')]]) {
  const code = source.slice(source.indexOf('function sortTimelineActivities'), source.indexOf('export function ActivitiesSection'))
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const sort = new Function(compiled + '; return sortTimelineActivities')()
  const ids = sort(fixtures).map((entry) => entry.id)
  console.log(label + ': ' + ids.join(', '))
  if (label === 'fixed' && ids.join(',') !== 'dated,undated-z,undated-a') process.exit(1)
}
