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
  const manageMatch = useMatch('/tours/:tourId/manage');
  const workspaceTourId = editorMatch?.params.tourId || manageMatch?.params.tourId;
  const activeWorkspace = workspace?.tourId === workspaceTourId ? workspace : null;

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
    <header className={`site-header${workspaceTourId ? ' site-header--workspace' : ''}`}>
      <Link className="brand" to="/">360<span>Walkthrough</span></Link>
      {workspaceTourId && <nav className="workspace-header" aria-label="Tour navigation">
        <Link className="text-link" to="/">← All tours</Link>
        <Link className="workspace-title" to={`/tours/${workspaceTourId}`} title={activeWorkspace?.title}>{activeWorkspace?.title || 'Walkthrough'}</Link>
        <Link className="button button--secondary workspace-manage-button" to={`/tours/${workspaceTourId}/manage`}
          aria-current={manageMatch ? 'page' : undefined}>Manage</Link>
      </nav>}
      <div className="header-account">
        {workspaceTourId && <>
          <span className="status workspace-save-status" data-tone={activeWorkspace?.saveState === 'error' ? 'error' : activeWorkspace?.saveState === 'saved' ? 'success' : undefined} role="status">
            {activeWorkspace?.saveState === 'saving' ? 'Saving…' : activeWorkspace?.saveState === 'error' ? 'Save failed' : 'Saved'}
          </span>
          <Link className="button button--secondary" to={`/tours/${workspaceTourId}/viewer`}>Open viewer</Link>
        </>}
        <span className="account-name">{user?.email}</span>
        {signOutError && <span className="status" data-tone="error" role="alert">Could not sign out. Try again.</span>}
        <button className="button button--secondary" onClick={() => void leave()}>Sign out</button>
      </div>
    </header>
    <WorkspaceHeaderContext.Provider value={setWorkspace}><Outlet /></WorkspaceHeaderContext.Provider>
  </div>;
}
