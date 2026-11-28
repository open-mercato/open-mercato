'use client'

import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { notificationTypes } from './notifications'

/**
 * No custom renderers: every notification this module sends is a sentence and a link, which the default
 * renderer already shows better than a bespoke component would.
 *
 * The file exists because the generator builds the browser-side type registry from a `default` export here, and
 * without it the module's types are known to the server and not to the bell menu.
 */
const marketingNotificationTypes: NotificationTypeDefinition[] = notificationTypes

export default marketingNotificationTypes
