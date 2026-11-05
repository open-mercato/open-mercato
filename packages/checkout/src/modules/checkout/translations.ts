import { CHECKOUT_ENTITY_IDS } from './lib/constants'

export const translatableFields: Record<string, string[]> = {
  [CHECKOUT_ENTITY_IDS.link]: [
    'name',
    'title',
    'subtitle',
    'description',
    'successTitle',
    'successMessage',
    'cancelTitle',
    'cancelMessage',
    'errorTitle',
    'errorMessage',
    'startEmailSubject',
    'startEmailBody',
    'successEmailSubject',
    'successEmailBody',
    'errorEmailSubject',
    'errorEmailBody',
  ],
  [CHECKOUT_ENTITY_IDS.template]: [
    'name',
    'title',
    'subtitle',
    'description',
    'successTitle',
    'successMessage',
    'cancelTitle',
    'cancelMessage',
    'errorTitle',
    'errorMessage',
    'startEmailSubject',
    'startEmailBody',
    'successEmailSubject',
    'successEmailBody',
    'errorEmailSubject',
    'errorEmailBody',
  ],
}

export default translatableFields
