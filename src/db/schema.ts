import { pgTable, serial, text, timestamp, boolean, integer, uuid } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).notNull().defaultNow(),
})

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  organizationId: uuid('organization_id').notNull(),
  passwordHash: text('password_hash'),
  isConfirmed: boolean('is_confirmed').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: false }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
})

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
})

export const userRoles = pgTable('user_roles', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  roleId: integer('role_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
})

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
}))

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  userRoles: many(userRoles),
}))

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
}))

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}))
