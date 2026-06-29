import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'storage_s3',
  title: 'S3-Compatible Storage',
  description:
    'Store attachments and files in AWS S3, DigitalOcean Spaces, MinIO, or any S3-compatible object storage.',
  category: 'storage',
  hub: 'storage_hubs',
  icon: 's3',
  package: '@open-mercato/storage-s3',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['s3', 'aws', 'storage', 'minio', 'digitalocean-spaces'],
  healthCheck: { service: 's3HealthCheck' },
  credentials: {
    fields: [
      {
        key: 'authMode',
        label: 'Authentication',
        type: 'select',
        required: false,
        helpText:
          'Choose how the AWS SDK should authenticate. For production deployments, prefer IAM roles (IRSA/instance profile) when available.',
        options: [
          { value: 'access_keys', label: 'Access keys' },
          { value: 'ambient', label: 'Credentials provided by AWS (STS / IRSA / instance profile)' },
        ],
      },
      {
        key: 'accessKeyId',
        label: 'Access Key ID',
        type: 'text',
        required: true,
        placeholder: 'AKIAIOSFODNN7EXAMPLE',
        helpText:
          'AWS IAM access key ID, or the equivalent key for your S3-compatible provider.',
        visibleWhen: { field: 'authMode', equals: 'access_keys' },
      },
      {
        key: 'secretAccessKey',
        label: 'Secret Access Key',
        type: 'secret',
        required: true,
        helpText:
          'AWS IAM secret access key, or the equivalent secret for your S3-compatible provider.',
        visibleWhen: { field: 'authMode', equals: 'access_keys' },
      },
      {
        key: 'sessionToken',
        label: 'Session Token (optional)',
        type: 'secret',
        required: false,
        helpText:
          'Optional AWS session token when using temporary credentials (e.g. from STS).',
        visibleWhen: { field: 'authMode', equals: 'access_keys' },
      },
      {
        key: 'region',
        label: 'Region',
        type: 'text',
        required: true,
        placeholder: 'eu-central-1',
        helpText: 'AWS region (e.g. eu-central-1). For DigitalOcean Spaces use the slug like fra1.',
      },
      {
        key: 'bucket',
        label: 'Bucket Name',
        type: 'text',
        required: true,
        placeholder: 'my-company-attachments',
        helpText: 'The S3 bucket where files will be stored.',
      },
      {
        key: 'endpoint',
        label: 'Custom Endpoint',
        type: 'url',
        required: false,
        placeholder: 'https://fra1.digitaloceanspaces.com',
        helpText: 'Custom S3 endpoint URL. Leave empty for AWS S3. Required for MinIO, DigitalOcean Spaces, and other providers.',
      },
      {
        key: 'forcePathStyle',
        label: 'Force Path Style',
        type: 'boolean',
        required: false,
        helpText: 'Enable path-style addressing. Required for MinIO. Leave disabled for AWS S3 and DigitalOcean Spaces.',
      },
    ],
  },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
