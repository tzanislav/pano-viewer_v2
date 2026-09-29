import { useRef, useState, type ChangeEvent } from 'react';
import type { Page, UnderlayUpload } from '@pano/domain';
import { errorMessage } from '../../app/apiClient';
import { putSignedFile } from '../tours/putSignedFile';
import { tourApi } from '../tours/tourApi';

const mimeByExtension: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp'
};

export function UnderlayControl({ tourId, page, tourVersion, uploads, onChanged }: {
  tourId: string; page: Page; tourVersion: number; uploads: UnderlayUpload[]; onChanged: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const pending = uploads.find(upload => upload.pageId === page.id && upload.id !== page.planAssetId);

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const mimeType = file.type || mimeByExtension[file.name.split('.').at(-1)?.toLowerCase() || ''];
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      setError('Choose a JPEG, PNG, or WebP underlay image.');
      return;
    }
    setBusy(true);
    setProgress(0);
    setError('');
    let assetId: string | undefined;
    let transferred = false;
    try {
      const reserved = await tourApi.reserveUnderlay(tourId, page.id, {
        fileName: file.name, mimeType, byteSize: file.size
      });
      assetId = reserved.upload.id;
      await putSignedFile(reserved.uploadUrl, file, mimeType, setProgress);
      transferred = true;
      setProgress(null);
      await tourApi.completeUnderlay(tourId, page.id, assetId);
      await onChanged();
    } catch (cause) {
      if (assetId && !transferred) {
        try { await tourApi.cancelUnderlay(tourId, page.id, assetId); } catch { /* The pending upload can be discarded below. */ }
      }
      setError(errorMessage(cause));
      await onChanged().catch(() => {});
    } finally { setBusy(false); setProgress(null); }
  }

  async function remove() {
    if (!window.confirm(`Remove the underlay from ${page.name}? Its stored image will be deleted.`)) return;
    setBusy(true);
    setError('');
    try {
      await tourApi.removeUnderlay(tourId, page.id, tourVersion);
      await onChanged();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function resolvePending(removePending: boolean) {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      if (removePending) await tourApi.cancelUnderlay(tourId, page.id, pending.id);
      else await tourApi.completeUnderlay(tourId, page.id, pending.id);
      await onChanged();
    } catch (cause) { setError(errorMessage(cause)); await onChanged().catch(() => {}); }
    finally { setBusy(false); }
  }

  return <div className="underlay-controls">
    <input ref={input} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
      onChange={event => void uploadFile(event)} aria-label={`Choose an underlay for ${page.name}`} />
    <button type="button" className="text-button" disabled={busy || Boolean(pending)} onClick={() => input.current?.click()}>
      {page.planAssetId ? 'Replace underlay' : 'Upload underlay'}
    </button>
    {page.planAssetId && <button type="button" className="underlay-remove" aria-label={`Remove underlay from ${page.name}`}
      title="Remove underlay" disabled={busy} onClick={() => void remove()}>×</button>}
    {busy && <span className="underlay-status" role="status">{progress === null ? 'Checking image…' : `Uploading ${progress}%`}</span>}
    {pending && !busy && <span className="underlay-pending">{pending.status === 'error' ? 'Upload failed' : 'Upload interrupted'} · <button className="text-button" onClick={() => void resolvePending(false)}>Check</button> · <button className="text-button" onClick={() => void resolvePending(true)}>Discard</button></span>}
    {error && <span className="underlay-error" role="alert">{error}</span>}
  </div>;
}
