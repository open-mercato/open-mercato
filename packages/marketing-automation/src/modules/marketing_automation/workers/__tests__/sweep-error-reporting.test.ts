import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every periodic maintenance pass the sweep runs on its own schedule logs a failure and moves on — that is
 * deliberate for the lead digest, score-rule scheduling, price watches and automatic winner selection, none
 * of which hold anything irreplaceable. The inbound-request log is different: it holds a partner's raw body
 * nowhere else, so a pruning failure that only logs is a failure nobody but a log-grep ever learns about.
 *
 * A structural test, matching this file's sibling conventions elsewhere in the module: the defect was an
 * import removed alongside an unrelated change, which no behavioural mock caught either.
 */
describe('the sweep worker reports inbound-request pruning failures', () => {
  const source = readFileSync(join(__dirname, '..', 'sweep.ts'), 'utf8')
  const catchStart = source.indexOf('} catch (error) {', source.indexOf('await pruneInboundRequests('))
  const catchBlock = source.slice(catchStart, source.indexOf('\n  }', catchStart) + 4)

  it('imports reportError', () => {
    expect(source).toContain("import { reportError } from '@open-mercato/telemetry'")
  })

  it('reports the failure, not only logs it', () => {
    expect(catchBlock).toContain('logger.warn')
    expect(catchBlock).toMatch(/reportError\(error, \{ module: 'marketing_automation', code: 'marketing_automation\.inbound_request_pruning_failed' \}\)/)
  })
})
