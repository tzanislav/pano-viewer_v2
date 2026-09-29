import type { PanoramaAsset, Tour, TourEditorData, UnderlayUpload, ViewerManifest } from '@pano/domain';
import { apiRequest, publicApiRequest } from '../../app/apiClient';

export const tourApi = {
  list: () => apiRequest<{ tours: Tour[] }>('/tours'),
  create: (title: string) => apiRequest<TourEditorData>('/tours', { method: 'POST', body: JSON.stringify({ title }) }),
  get: (id: string) => apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}`),
  delete: (id: string, expectedVersion: number) =>
    apiRequest<void>(`/tours/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ expectedVersion }) }),
  viewerManifest: (id: string) => apiRequest<ViewerManifest>(`/tours/${encodeURIComponent(id)}/viewer-manifest`),
  share: (id: string) => apiRequest<{ token: string | null }>(`/tours/${encodeURIComponent(id)}/share`),
  createShare: (id: string) => apiRequest<{ token: string }>(`/tours/${encodeURIComponent(id)}/share`, { method: 'POST' }),
  revokeShare: (id: string) => apiRequest<void>(`/tours/${encodeURIComponent(id)}/share`, { method: 'DELETE' }),
  sharedViewerManifest: (token: string) => publicApiRequest<ViewerManifest>(`/shares/${encodeURIComponent(token)}/manifest`),
  createViewerLink: (id: string, body: { sourceSceneId: string; targetSceneId: string; yawDeg: number; pitchDeg: number; expectedVersion: number }) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/links`, { method: 'POST', body: JSON.stringify(body) }),
  updateViewerLink: (id: string, linkId: string, body: { yawDeg: number; pitchDeg: number; expectedVersion: number }) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/links/${encodeURIComponent(linkId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteViewerLink: (id: string, linkId: string, expectedVersion: number) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/links/${encodeURIComponent(linkId)}`, {
      method: 'DELETE', body: JSON.stringify({ expectedVersion })
    }),
  update: (id: string, body: { expectedVersion: number; title?: string; defaultNorthYawDeg?: number; entrySceneId?: string | null }) =>
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
    apiRequest<{ url: string; expiresIn: number }>(`/tours/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}/thumbnail-url`),
  reserveUnderlay: (id: string, pageId: string, file: { fileName: string; mimeType: string; byteSize: number }) =>
    apiRequest<{ upload: UnderlayUpload; uploadUrl: string; expiresIn: number }>(`/tours/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}/underlay/uploads`, {
      method: 'POST', body: JSON.stringify(file)
    }),
  completeUnderlay: (id: string, pageId: string, assetId: string) =>
    apiRequest<{ upload: UnderlayUpload }>(`/tours/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}/underlay/uploads/${encodeURIComponent(assetId)}/complete`, { method: 'POST' }),
  cancelUnderlay: (id: string, pageId: string, assetId: string) =>
    apiRequest<void>(`/tours/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}/underlay/uploads/${encodeURIComponent(assetId)}`, { method: 'DELETE' }),
  underlayUrl: (id: string, pageId: string) =>
    apiRequest<{ url: string; expiresIn: number }>(`/tours/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}/underlay-url`),
  removeUnderlay: (id: string, pageId: string, expectedVersion: number) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}/underlay`, {
      method: 'DELETE', body: JSON.stringify({ expectedVersion })
    }),
  createPlacement: (id: string, body: { pageId: string; sceneId: string; x: number; y: number; expectedVersion: number }) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/placements`, { method: 'POST', body: JSON.stringify(body) }),
  updatePlacement: (id: string, placementId: string, body: { x: number; y: number; expectedVersion: number }) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/placements/${encodeURIComponent(placementId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deletePlacement: (id: string, placementId: string, expectedVersion: number) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/placements/${encodeURIComponent(placementId)}`, {
      method: 'DELETE', body: JSON.stringify({ expectedVersion })
    }),
  deleteScene: (id: string, sceneId: string, expectedVersion: number) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/scenes/${encodeURIComponent(sceneId)}`, {
      method: 'DELETE', body: JSON.stringify({ expectedVersion })
    }),
  createPlanConnection: (id: string, body: { placementAId: string; placementBId: string; expectedVersion: number }) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/connections`, { method: 'POST', body: JSON.stringify(body) }),
  deletePlanConnection: (id: string, connectionId: string, expectedVersion: number) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/connections/${encodeURIComponent(connectionId)}`, {
      method: 'DELETE', body: JSON.stringify({ expectedVersion })
    }),
  deletePlanDirection: (id: string, linkId: string, expectedVersion: number) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/connections/directions/${encodeURIComponent(linkId)}`, {
      method: 'DELETE', body: JSON.stringify({ expectedVersion })
    }),
  resetPlanDirection: (id: string, linkId: string, expectedVersion: number) =>
    apiRequest<TourEditorData>(`/tours/${encodeURIComponent(id)}/links/${encodeURIComponent(linkId)}/reset-to-plan`, {
      method: 'POST', body: JSON.stringify({ expectedVersion })
    })
};
