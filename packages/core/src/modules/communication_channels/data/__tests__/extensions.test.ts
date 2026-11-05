import type { EntityExtension } from '@open-mercato/shared/modules/entities'
import { extensions } from '../extensions'

describe('communication_channels extensions', () => {
  it('declares 6 cross-module extensions (4 from slice 2a + 2 per-user added in slice 3a)', () => {
    expect(extensions).toHaveLength(6)
  })

  it('every extension has the canonical EntityExtension shape', () => {
    for (const ext of extensions) {
      // Type system guarantees this at compile time; the runtime assertions are a belt-and-braces check.
      expect(typeof ext.base).toBe('string')
      expect(ext.base).toMatch(/^[a-z_]+:[a-z_]+$/)
      expect(typeof ext.extension).toBe('string')
      expect(ext.extension).toMatch(/^[a-z_]+:[a-z_]+$/)
      expect(ext.join).toBeDefined()
      expect(typeof ext.join.baseKey).toBe('string')
      expect(typeof ext.join.extensionKey).toBe('string')
    }
  })

  it('extends messages:message twice (link + reactions)', () => {
    const onMessage = extensions.filter((e) => e.base === 'messages:message')
    expect(onMessage).toHaveLength(2)
    const extensionEntities = onMessage.map((e) => e.extension).sort()
    expect(extensionEntities).toEqual([
      'communication_channels:message_channel_link',
      'communication_channels:message_reaction',
    ])
  })

  it('extends auth:user with assigned conversations', () => {
    const onUser = extensions.find((e) => e.base === 'auth:user')
    expect(onUser).toBeDefined()
    expect(onUser?.extension).toBe('communication_channels:external_conversation')
    expect(onUser?.join.extensionKey).toBe('assigned_user_id')
  })

  it('extends customers:customer_entity with matched conversations', () => {
    const onPerson = extensions.find((e) => e.base === 'customers:customer_entity')
    expect(onPerson).toBeDefined()
    expect(onPerson?.extension).toBe('communication_channels:external_conversation')
    expect(onPerson?.join.extensionKey).toBe('contact_person_id')
  })

  it('the typed array passes the EntityExtension contract', () => {
    // Compile-time check expressed at runtime via inferred type
    const _typed: EntityExtension[] = extensions
    expect(_typed).toBe(extensions)
  })
})
