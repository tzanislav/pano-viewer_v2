import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { photoNameKey, type PanoramaAsset } from '@pano/domain';
import { errorMessage } from '../../app/apiClient';
import { putSignedFile } from './putSignedFile';
import { tourApi } from './tourApi';

type UploadItem = {
  id: number;
  file: File;
  nameKey: string;
  status: 'queued' | 'uploading' | 'processing' | 'error';
  progress: number;
  error?: string;
};

const mimeByExtension: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp'
};

function fileMime(file: File): string {
  return file.type || mimeByExtension[file.name.split('.').at(-1)?.toLowerCase() || ''] || '';
}

export function PhotoUploader({ tourId, assets, onChanged }: {
  tourId: string; assets: PanoramaAsset[]; onChanged: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const nameChains = useRef(new Map<string, Promise<void>>());
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [actionError, setActionError] = useState('');

  function changeItem(id: number, update: Partial<UploadItem>) {
    setItems(current => current.map(item => item.id === id ? { ...item, ...update } : item));
  }

  async function upload(item: UploadItem) {
    let assetId: string | undefined;
    let transferred = false;
    try {
      const mimeType = fileMime(item.file);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        throw new Error('Choose a JPEG, PNG, or WebP image.');
      }
      changeItem(item.id, { status: 'uploading' });
      const reserved = await tourApi.reserveUpload(tourId, {
        fileName: item.file.name, mimeType, byteSize: item.file.size
      });
      assetId = reserved.asset.id;
      await onChanged();
      await putSignedFile(reserved.uploadUrl, item.file, mimeType, progress => changeItem(item.id, { progress }));
      transferred = true;
      changeItem(item.id, { status: 'processing', progress: 100 });
      await tourApi.completeUpload(tourId, assetId);
      await onChanged();
      setItems(current => current.filter(candidate => candidate.id !== item.id));
    } catch (cause) {
      if (assetId && !transferred) {
        try { await tourApi.cancelUpload(tourId, assetId); } catch { /* Keep the upload visible for removal. */ }
      }
      changeItem(item.id, { status: 'error', error: errorMessage(cause) });
      await onChanged().catch(() => {});
    }
  }

  function enqueue(files: File[]) {
    if (!files.length) return;
    setActionError('');
    for (const file of files) {
      let nameKey: string;
      try { nameKey = photoNameKey(file.name); }
      catch { nameKey = file.name.toLowerCase(); }
      const item: UploadItem = { id: ++nextId.current, file, nameKey, status: 'queued', progress: 0 };
      setItems(current => [...current, item]);
      const previous = nameChains.current.get(nameKey) || Promise.resolve();
      const task = previous.catch(() => {}).then(() => upload(item));
      nameChains.current.set(nameKey, task);
      void task.finally(() => {
        if (nameChains.current.get(nameKey) === task) nameChains.current.delete(nameKey);
      });
    }
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    enqueue(Array.from(event.target.files || []));
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    enqueue(Array.from(event.dataTransfer.files));
  }

  async function removePending(assetId: string) {
    setActionError('');
    try {
      await tourApi.cancelUpload(tourId, assetId);
      await onChanged();
    } catch (cause) { setActionError(errorMessage(cause)); }
  }

  async function finishPending(assetId: string) {
    setActionError('');
    try {
      await tourApi.completeUpload(tourId, assetId);
      await onChanged();
    } catch (cause) {
      setActionError(errorMessage(cause));
      await onChanged().catch(() => {});
    }
  }

  const pending = assets.filter(asset => asset.status !== 'ready' &&
    !items.some(item => item.nameKey === asset.filenameKey && item.status !== 'error'));
  return <div className="photo-uploader">
    <div className={`photo-drop-zone${dragging ? ' photo-drop-zone--active' : ''}`}
      onDragEnter={event => { event.preventDefault(); setDragging(true); }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={handleDrop}>
      <input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple onChange={handleInput} aria-label="Choose panorama photos" />
      <p>Drag and drop 360 photos here</p>
      <button type="button" className="button button--secondary" onClick={() => inputRef.current?.click()}>Choose photos</button>
      <small>JPEG, PNG or WebP · 2:1 panorama · multiple files</small>
    </div>
    <p className="photo-upload-note">Uploading a photo with the same name replaces it in this tour. Its placement and links stay in place.</p>
    {actionError && <p className="status" data-tone="error" role="alert">{actionError}</p>}
    {items.length > 0 && <div className="photo-list" aria-label="Upload progress">{items.map(item =>
      <div className="photo-upload-row" key={item.id}>
        <strong title={item.file.name}>{item.file.name}</strong>
        <span className="muted">{item.status === 'error' ? item.error : item.status === 'uploading' ? `Uploading ${item.progress}%` : item.status === 'processing' ? 'Checking photo…' : 'Waiting…'}</span>
        {item.status === 'uploading' && <progress value={item.progress} max={100} aria-label={`${item.file.name} upload progress`} />}
        {item.status === 'error' && <button className="text-button" onClick={() => { setItems(current => current.filter(candidate => candidate.id !== item.id)); enqueue([item.file]); }}>Try again</button>}
      </div>
    )}</div>}
    {pending.length > 0 && <div className="photo-list" aria-label="Pending photos">{pending.map(asset =>
      <div className="photo-upload-row" key={asset.id}>
        <strong title={asset.fileName}>{asset.fileName}</strong>
        <span className="muted">{asset.status === 'error' ? `Upload error${asset.errorCode ? `: ${asset.errorCode}` : ''}` : asset.status === 'processing' ? 'Processing interrupted' : 'Upload interrupted'}</span>
        <div className="photo-row-actions"><button className="text-button" onClick={() => void finishPending(asset.id)}>Check upload</button><button className="text-button" onClick={() => void removePending(asset.id)}>Remove</button></div>
      </div>
    )}</div>}
  </div>;
}
