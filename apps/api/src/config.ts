import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnv({ path: resolve(repositoryRoot, '.env'), quiet: true });

export function apiConfig() {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required');
  const region = process.env.AWS_REGION?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  if (!region || !bucket) throw new Error('AWS_REGION and S3_BUCKET are required');
  return {
    projectId,
    port: Number(process.env.PORT || 3001),
    webOrigin: process.env.WEB_ORIGIN || 'http://localhost:5173',
    databasePath: resolve(repositoryRoot, process.env.DATABASE_PATH || './data/pano-viewer.sqlite'),
    region,
    bucket,
    s3Endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE?.trim() === 'true',
    maxPanoramaBytes: Number(process.env.MAX_PANORAMA_BYTES || 104857600),
    uploadUrlTtlSeconds: Number(process.env.S3_UPLOAD_URL_TTL_SECONDS || 600),
    readUrlTtlSeconds: Number(process.env.S3_READ_URL_TTL_SECONDS || 900)
  };
}
