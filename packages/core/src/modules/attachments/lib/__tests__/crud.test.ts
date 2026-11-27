jest.mock('#generated/entities.ids.generated', () => ({ E: {} }))

import { attachmentCrudIndexer } from '../crud'

test('uses the registered attachment entity ID even when Attachments is disabled', () => {
  expect(attachmentCrudIndexer.entityType).toBe('attachments:attachment')
})
