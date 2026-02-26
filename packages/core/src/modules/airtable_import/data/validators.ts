import { z } from "zod";

export const createSessionSchema = z.object({
  airtableToken: z.string().min(1, "Token Airtable jest wymagany"),
  airtableBaseId: z.string().min(1, "ID bazy Airtable jest wymagany"),
});

export const updateMappingSchema = z.object({
  mapping: z.object({
    tables: z.array(
      z.object({
        airtableTableId: z.string(),
        airtableTableName: z.string(),
        targetModule: z.string().nullable(),
        targetEntitySlug: z.string().nullable(),
        confidence: z.number().min(0).max(100).optional().default(0),
        skip: z.boolean(),
        fieldMappings: z.array(
          z.object({
            airtableFieldId: z.string(),
            airtableFieldName: z.string(),
            airtableFieldType: z.string(),
            omFieldKey: z.string().nullable(),
            omFieldType: z.string().nullable(),
            isMappedToCreatedAt: z.boolean().optional().default(false),
            isMappedToUpdatedAt: z.boolean().optional().default(false),
            skip: z.boolean().optional().default(false),
            sampleValues: z.array(z.unknown()).optional().default([]),
          }),
        ),
      }),
    ),
  }),
});

export const updateConfigSchema = z.object({
  config: z.object({
    importUsers: z.boolean(),
    importAttachments: z.boolean(),
    preserveDates: z.boolean(),
    addAirtableIdField: z.boolean(),
    overwriteExisting: z.boolean().optional().default(false),
    userRoleMapping: z.record(z.string(), z.string()),
  }),
});

export const connectSchema = z.object({
  airtableToken: z.string().min(1),
  airtableBaseId: z.string().min(1),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateMappingInput = z.infer<typeof updateMappingSchema>;
export type UpdateConfigInput = z.infer<typeof updateConfigSchema>;
export type ConnectInput = z.infer<typeof connectSchema>;
