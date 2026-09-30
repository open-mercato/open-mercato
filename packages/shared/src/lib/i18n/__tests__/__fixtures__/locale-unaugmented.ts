// Fixture: with no augmentation in the program, an unshipped code must still be
// rejected — the zero-config guarantee. Expected to produce a diagnostic.
import type { Locale } from '../../config'

export const unregistered: Locale = 'cs'
