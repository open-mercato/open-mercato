/**
 * Regression coverage for issue #2097 (BUG-004): the conversation-sharing
 * UI and notification strings MUST ship localized values in every supported
 * locale, not the English copy. Catches drift when keys are renamed/added
 * but their PL/DE/ES values are forgotten.
 */

import enDict from '../en.json'
import plDict from '../pl.json'
import deDict from '../de.json'
import esDict from '../es.json'

type Dict = Record<string, string>

const KEYS_TO_LOCALIZE = [
  'ai_assistant.chat.readOnlyNotice',
  'ai_assistant.launcher.composerPlaceholder',
  'ai_assistant.notifications.conversation_shared.title',
  'ai_assistant.notifications.conversation_shared.body',
  'ai_assistant.notifications.conversation_shared.view_button',
  'ai_assistant.share.addParticipant',
  'ai_assistant.share.allUsersAdded',
  'ai_assistant.share.dialogDescription',
  'ai_assistant.share.dialogTitle',
  'ai_assistant.share.noParticipants',
  'ai_assistant.share.participantPlaceholder',
  'ai_assistant.share.removeParticipant',
  'ai_assistant.share.saved',
  'ai_assistant.share.saving',
  'ai_assistant.share.selectUser',
  'ai_assistant.share.shareButton',
]

const LOCALE_DICTS: Array<[string, Dict]> = [
  ['pl', plDict as Dict],
  ['de', deDict as Dict],
  ['es', esDict as Dict],
]

describe('ai_assistant conversation-share i18n keys', () => {
  it.each(KEYS_TO_LOCALIZE)('en.json defines %s', (key) => {
    expect((enDict as Dict)[key]).toBeTruthy()
  })

  for (const [locale, dict] of LOCALE_DICTS) {
    describe(`${locale}.json`, () => {
      it.each(KEYS_TO_LOCALIZE)('defines %s', (key) => {
        expect(dict[key]).toBeTruthy()
      })

      it.each(KEYS_TO_LOCALIZE)('localizes %s (value differs from en)', (key) => {
        const enValue = (enDict as Dict)[key]
        const localizedValue = dict[key]
        expect(localizedValue).toBeTruthy()
        expect(localizedValue).not.toBe(enValue)
      })
    })
  }
})
