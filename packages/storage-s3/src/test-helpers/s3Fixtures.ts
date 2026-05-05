import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'

const LOCALSTACK_PORT = process.env.LOCALSTACK_PORT || '4566'
const LOCALSTACK_ENDPOINT = `http://localhost:${LOCALSTACK_PORT}`

function createLocalstackClient(): S3Client {
  return new S3Client({
    region: 'us-east-1',
    endpoint: LOCALSTACK_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.LOCALSTACK_S3_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.LOCALSTACK_S3_SECRET_ACCESS_KEY || 'test',
    },
  })
}

export async function createS3Bucket(bucketName: string): Promise<void> {
  const client = createLocalstackClient()
  await client.send(new CreateBucketCommand({ Bucket: bucketName }))
}

export async function deleteS3Bucket(bucketName: string): Promise<void> {
  const client = createLocalstackClient()

  // Empty the bucket first (required before deletion)
  let continuationToken: string | undefined
  do {
    const listResult = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        ContinuationToken: continuationToken,
      }),
    )
    const objects = listResult.Contents ?? []
    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: {
            Objects: objects.map((obj) => ({ Key: obj.Key! })),
            Quiet: true,
          },
        }),
      )
    }
    continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined
  } while (continuationToken)

  await client.send(new DeleteBucketCommand({ Bucket: bucketName }))
}

export function localstackS3Config(bucketName: string): Record<string, unknown> {
  return {
    bucket: bucketName,
    region: 'us-east-1',
    endpoint: LOCALSTACK_ENDPOINT,
    forcePathStyle: true,
    credentialsEnvPrefix: 'LOCALSTACK_S3',
  }
}

export function isLocalstackAvailable(): boolean {
  return Boolean(process.env.LOCALSTACK_PORT || process.env.LOCALSTACK_S3_ACCESS_KEY_ID)
}
