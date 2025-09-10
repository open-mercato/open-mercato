import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

export const exampleItems = pgTable('example_items', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
})
