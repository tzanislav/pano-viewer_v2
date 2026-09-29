import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export type VerifyToken = (token: string) => Promise<string>;

export function createTokenVerifier(projectId: string): VerifyToken {
  if (process.env.NODE_ENV === 'production' && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Firebase Auth emulator cannot be enabled in production');
  }
  const app = getApps()[0] ?? initializeApp({
    projectId,
    ...(process.env.FIREBASE_AUTH_EMULATOR_HOST ? {} : { credential: applicationDefault() })
  });
  return async (token: string) => (await getAuth(app).verifyIdToken(token, true)).uid;
}
