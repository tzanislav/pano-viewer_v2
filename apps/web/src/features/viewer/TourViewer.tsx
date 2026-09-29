import { useEffect, useState } from 'react';
import type { TourEditorData } from '@pano/domain';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '../../app/apiClient';
import { tourApi } from '../tours/tourApi';

export function TourViewer() {
  const { tourId = '' } = useParams();
  const [data, setData] = useState<TourEditorData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void tourApi.get(tourId).then((result) => { if (active) setData(result); })
      .catch((cause) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [tourId]);
  return <main className="viewer-page">
    <div className="viewer-heading"><div><p className="eyebrow">Viewer mode</p><h1>{data?.tour.title || 'Walkthrough'}</h1></div><Link className="button button--secondary" to={`/tours/${tourId}`}>Back to editor</Link></div>
    <div className="viewer-empty" role="status">{error ? <p className="status" data-tone="error">{error}</p> : data ? data.scenes.length > 0 ? <><h2>{data.scenes.length} {data.scenes.length === 1 ? 'panorama' : 'panoramas'} uploaded</h2><p>Interactive panorama viewing is the next step. Your uploaded photos are saved in the tour.</p></> : <><h2>No panoramas yet</h2><p>Upload photos in the editor to start this tour.</p></> : <p>Loading viewer…</p>}</div>
  </main>;
}
