// Re-export from shared for backward compatibility
// New code should import directly from @open-mercato/shared/modules/entities/validators
export {
  entityIdRegex,
  fieldsetCodeRegex,
  upsertCustomEntitySchema,
  upsertCustomFieldDefSchema,
  customFieldsetGroupSchema,
  customFieldsetSchema,
  customFieldEntityConfigSchema,
  encryptionFieldRuleSchema,
  upsertEncryptionMapSchema,
  type UpsertCustomEntityInput,
  type UpsertCustomFieldDefInput,
  type UpsertEncryptionMapInput,
} from '@open-mercato/shared/modules/entities/validators'
