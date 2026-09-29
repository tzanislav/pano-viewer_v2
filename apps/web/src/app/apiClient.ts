import { auth } from '../auth/firebaseClient';

const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

export class ApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly requestId?: string) {
    super(message);
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError('Sign in is required', 'UNAUTHENTICATED');
  const token = await user.getIdToken();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string; code?: string; requestId?: string } } | null;
    throw new ApiError(body?.error?.message || 'The request failed', body?.error?.code || 'REQUEST_FAILED', body?.error?.requestId);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.message}${error.requestId ? ` (request ${error.requestId})` : ''}`;
  return error instanceof Error ? error.message : 'Something went wrong';
}
