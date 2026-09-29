import { signOut } from 'firebase/auth';
import { createContext, useContext, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { auth } from '../auth/firebaseClient';
import { useAuth } from '../auth/AuthProvider';
import { logAction } from './logAction';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
interface WorkspaceHeader { tourId: string; title: string; saveState: SaveState }
const WorkspaceHeaderContext = createContext<Dispatch<SetStateAction<WorkspaceHeader | null>> | null>(null);

export function useWorkspaceHeader() {
  const setHeader = useContext(WorkspaceHeaderContext);
  if (!setHeader) throw new Error('Workspace header must be used inside the app shell');
  return setHeader;
}

export function AppShell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [signOutError, setSignOutError] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceHeader | null>(null);
  const editorMatch = useMatch('/tours/:tourId');
  const editorTourId = editorMatch?.params.tourId;
  const activeWorkspace = workspace?.tourId === editorTourId ? workspace : null;

  async function leave() {
    try {
      await signOut(auth);
      logAction('auth.sign-out', 'success');
      navigate('/sign-in');
    } catch {
      setSignOutError(true);
      logAction('auth.sign-out', 'failure');
    }
  }
  return <div className="app-shell">
    <header className={`site-header${editorTourId ? ' site-header--workspace' : ''}`}>
      <Link className="brand" to="/">360<span>Walkthrough</span></Link>
      {editorTourId && <nav className="workspace-header" aria-label="Tour navigation">
        <Link className="text-link" to="/">← All tours</Link>
        <span className="workspace-title" title={activeWorkspace?.title}>{activeWorkspace?.title || 'Walkthrough'}</span>
      </nav>}
      <div className="header-account">
        {editorTourId && <>
          <span className="status workspace-save-status" data-tone={activeWorkspace?.saveState === 'error' ? 'error' : activeWorkspace?.saveState === 'saved' ? 'success' : undefined} role="status">
            {activeWorkspace?.saveState === 'saving' ? 'Saving…' : activeWorkspace?.saveState === 'error' ? 'Save failed' : 'Saved'}
          </span>
          <Link className="button button--secondary" to={`/tours/${editorTourId}/viewer`}>Open viewer</Link>
        </>}
        <span className="account-name">{user?.email}</span>
        {signOutError && <span className="status" data-tone="error" role="alert">Could not sign out. Try again.</span>}
        <button className="button button--secondary" onClick={() => void leave()}>Sign out</button>
      </div>
    </header>
    <WorkspaceHeaderContext.Provider value={setWorkspace}><Outlet /></WorkspaceHeaderContext.Provider>
  </div>;
}
