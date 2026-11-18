import { assertTrustedEventTriggerIdentity } from '../event-trigger-identity'

describe('event trigger identity rollout guard', () => {
  test.each(['victim-user', '', undefined, 'trigger:other-trigger'])('refuses mismatched persisted identity %s', (initiatedBy) => {
    expect(() => assertTrustedEventTriggerIdentity({
      metadata: { initiatedBy, labels: { trigger_id: 'persisted-trigger' } },
    })).toThrow('Untrusted legacy event-triggered workflow identity')
  })

  test('accepts the server-owned trigger marker including inherited sub-workflow labels', () => {
    expect(() => assertTrustedEventTriggerIdentity({
      metadata: {
        initiatedBy: 'trigger:persisted-trigger',
        labels: { trigger_id: 'persisted-trigger', parentInstanceId: 'parent-instance' },
      },
    })).not.toThrow()
  })

  test('preserves manually started identities and instances without trigger labels', () => {
    for (const metadata of [undefined, null, {}, { initiatedBy: 'manual-user' }]) {
      expect(() => assertTrustedEventTriggerIdentity({ metadata })).not.toThrow()
    }
  })
})
