import { useEffect, useState, type FormEvent } from 'react';
import type { Tour } from '@pano/domain';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage } from '../../app/apiClient';
import { logAction } from '../../app/logAction';
import { tourApi } from './tourApi';

export function TourList() {
  const navigate = useNavigate();
  const [tours, setTours] = useState<Tour[] | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void tourApi.list().then(({ tours }) => { if (active) setTours(tours); })
      .catch((cause) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await tourApi.create(title.trim());
      logAction('tour.create', 'success', { tourId: data.tour.id });
      navigate(`/tours/${data.tour.id}`);
    } catch (cause) {
      setError(errorMessage(cause));
      logAction('tour.create', 'failure');
    } finally { setBusy(false); }
  }

  return <main className="page-wrap">
    <div className="section-heading"><div><p className="eyebrow">Your workspace</p><h1>Walkthroughs</h1><p className="muted">Create a tour, organize floors, and build a path through each space.</p></div></div>
    <div className="home-layout">
      <section className="panel tour-list-panel" aria-labelledby="tour-list-heading">
        <h2 id="tour-list-heading">Your tours</h2>
        {error && <p className="status" data-tone="error" role="alert">{error}</p>}
        {tours === null ? <p className="muted">Loading tours…</p> : tours.length === 0 ? <p className="empty-copy">No tours yet. Create your first walkthrough to get started.</p> :
          <div className="tour-list">{tours.map((tour) => <Link className="tour-row" to={`/tours/${tour.id}`} key={tour.id}>
            <span><strong>{tour.title}</strong><small>Updated {new Date(tour.updatedAt).toLocaleDateString()}</small></span><span aria-hidden="true">↗</span>
          </Link>)}</div>}
      </section>
      <section className="panel new-tour-panel" aria-labelledby="new-tour-heading">
        <p className="eyebrow">Start here</p><h2 id="new-tour-heading">New walkthrough</h2>
        <p className="muted">A ground floor page will be ready for you. Add more pages at any time.</p>
        <form onSubmit={(event) => void create(event)}>
          <label className="field">Tour name<input maxLength={120} required placeholder="e.g. Riverside apartment" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <button className="button" disabled={busy}>{busy ? 'Creating…' : 'Create tour'}</button>
        </form>
      </section>
    </div>
  </main>;
}
