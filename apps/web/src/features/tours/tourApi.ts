import type { PanoramaAsset, Tour, TourEditorData } from '@pano/domain';
import { apiRequest } from '../../app/apiClient';

export const tourApi = {
  list: () => apiRequest<{ tours: Tour[] }>('/tours'),
  create: (title: string) => apiRequest<TourEditorData>('/tours', { method: 'POST', body: JSON.stringify({ title }) }),
  get: (id: string) => apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}`),
  update: (id: string, body: { expectedVersion: number; title?: string; defaultNorthYawDeg?: number }) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  createPage: (id: string, body: { expectedVersion: number; name: string }) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/pages`, { method: 'POST', body: JSON.stringify(body) }),
  updatePage: (id: string, pageId: string, body: { expectedVersion: number; name?: string; northAngleDeg?: number }) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deletePage: (id: string, pageId: string, expectedVersion: number) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}`, { method: 'DELETE', body: JSON.stringify({ expectedVersion }) }),
  reserveUpload: (id: string, file: { fileName: string; mimeType: string; byteSize: number }) =>
    apiRequest<{ asset: PanoramaAsset; uploadUrl: string; expiresIn: number }>(`/tours/${encodeURIComponent(id)}/uploads`, {
      method: 'POST', body: JSON.stringify(file)
    }),
  completeUpload: (id: string, assetId: string) =>
    apiRequest<{ asset: PanoramaAsset; sceneId: string | null }>(`/tours/${encodeURIComponent(id)}/uploads/${encodeURIComponent(assetId)}/complete`, { method: 'POST' }),
  cancelUpload: (id: string, assetId: string) =>
    apiRequest<void>(`/tours/${encodeURIComponent(id)}/uploads/${encodeURIComponent(assetId)}`, { method: 'DELETE' }),
  thumbnailUrl: (id: string, assetId: string) =>
    apiRequest<{ url: string; expiresIn: number }>(`/tours/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}/thumbnail-url`)
};
