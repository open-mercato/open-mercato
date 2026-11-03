import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import aiTools from '../../ai-tools'

/**
 * A mutating tool has to tell the approval card what will change.
 *
 * `prepareMutation` ships `fieldDiff: []` for a mutating tool with no `loadBeforeRecord`, so the one card
 * standing between an agent and a live campaign showed the operator nothing but a tool name. An edit to a
 * campaign that is already messaging customers is exactly the case the card exists for, and exactly the case
 * it was blank for.
 *
 * `create_campaign` is the named exception: there is no before-state to diff a creation against.
 */
const NO_BEFORE_STATE = ['marketing_automation.create_campaign']

describe('mutating marketing tools', () => {
  const mutating = aiTools.filter((tool) => tool.isMutation === true)

  it('finds the tools it is meant to be guarding', () => {
    expect(mutating.length).toBeGreaterThan(0)
  })

  for (const tool of mutating) {
    it(`${tool.name} ${NO_BEFORE_STATE.includes(tool.name) ? 'is exempt and says so' : 'loads a before-state'}`, () => {
      if (NO_BEFORE_STATE.includes(tool.name)) {
        expect(tool.loadBeforeRecord).toBeUndefined()
        return
      }
      expect(typeof tool.loadBeforeRecord).toBe('function')
    })
  }
})

/**
 * Who approved the change, recorded as the author of the revision.
 *
 * The command runs as a system actor — a campaign's writes are the module's, not the agent's — and a system
 * actor has no `auth`, so every campaign an agent saved was recorded with no author at all and the version
 * list could not say who had approved the change the card was shown for.
 */
describe('the authoring tools and the revision author', () => {
  const source = readFileSync(join(__dirname, '..', 'authoring-pack.ts'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('passes the approving user to the save command', () => {
    expect(code).toContain('onBehalfOfUserId: context.userId')
  })

  it('does not pass one where no revision is written', () => {
    // `create` records no revision, so an author there would be a field nothing reads.
    expect(code.split('onBehalfOfUserId').length - 1).toBe(1)
  })
})

/**
 * Only a system actor may name somebody else, and an HTTP caller's own identity always wins.
 */
describe('the command that honours it', () => {
  const source = readFileSync(
    join(__dirname, '..', '..', 'commands', 'campaigns.ts'),
    'utf8',
  )
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('prefers the authenticated caller over anything sent in the input', () => {
    const resolver = code.slice(code.indexOf('function revisionActorId'))
    const authLine = resolver.indexOf("ctx.auth?.sub")
    const claimedLine = resolver.indexOf('onBehalfOfUserId')
    expect(authLine).toBeGreaterThanOrEqual(0)
    expect(claimedLine).toBeGreaterThan(authLine)
  })

  it('ignores the claim unless the caller is a system actor', () => {
    expect(code).toContain('ctx.systemActor !== true')
  })

  it('is the only way a revision author is resolved', () => {
    // Two call sites, one rule: a second inline `ctx.auth?.sub` beside a revision would drift from it.
    // Counted on the call shape, not the name, which the declaration also carries.
    expect(code.split('revisionActorId(ctx, rawInput').length - 1).toBe(2)
    const beside = code.match(/actorId:[^\n]*ctx\.auth/g) ?? []
    expect(beside).toEqual([])
  })
})
