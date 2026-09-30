import { createHash, createHmac } from 'node:crypto';

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const hmac = (key: Buffer | string, data: string) =>
  createHmac('sha256', key).update(data).digest();
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** Encodage d'un segment de chemin comme l'exige la signature AWS (RFC 3986). */
const encodePath = (key: string) =>
  key
    .split('/')
    .map((s) =>
      encodeURIComponent(s).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');

/**
 * Dépôt d'un objet sur un stockage compatible S3 (AWS S3, Cloudflare R2, Backblaze B2, MinIO…)
 * avec la signature AWS SigV4, en adressage « path-style ». Sans dépendance externe.
 */
export async function s3PutObject(
  config: S3Config,
  key: string,
  body: Buffer,
  payloadSha256: string,
  now: Date = new Date(),
): Promise<void> {
  const url = new URL(config.endpoint);
  const path = `/${encodePath(config.bucket)}/${encodePath(key)}`;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = [
    'PUT',
    path,
    '',
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadSha256}`,
    `x-amz-date:${amzDate}`,
    '',
    signedHeaders,
    payloadSha256,
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, date), config.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const response = await fetch(`${url.origin}${path}`, {
    method: 'PUT',
    headers: {
      'x-amz-content-sha256': payloadSha256,
      'x-amz-date': amzDate,
      'content-type': 'application/octet-stream',
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: new Uint8Array(body),
  });
  if (!response.ok) {
    const text = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`Stockage hors site : HTTP ${response.status} ${text}`);
  }
}
