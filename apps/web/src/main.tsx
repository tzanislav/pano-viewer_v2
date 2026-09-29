import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import '@pano/ui/tokens.css';
import '@pano/ui/controls.css';
import './styles.css';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { AuthScreen } from './auth/AuthScreen';
import { AppShell } from './app/AppShell';
import { TourList } from './features/tours/TourList';
import { TourEditor } from './features/editor/TourEditor';
import { TourManage } from './features/tours/TourManage';
const TourViewer = lazy(() => import('./features/viewer/TourViewer').then(module => ({ default: module.TourViewer })));
const SharedTourViewer = lazy(() => import('./features/viewer/SharedTourViewer').then(module => ({ default: module.SharedTourViewer })));

createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><AuthProvider>
  <Routes>
    <Route path="/sign-in" element={<AuthScreen mode="sign-in" />} />
    <Route path="/create-account" element={<AuthScreen mode="create-account" />} />
    <Route path="/forgot-password" element={<AuthScreen mode="forgot-password" />} />
    <Route path="/share/:token" element={<Suspense fallback={<div className="loading-screen">Loading viewer…</div>}><SharedTourViewer /></Suspense>} />
    <Route element={<RequireAuth />}>
      <Route element={<AppShell />}>
        <Route index element={<TourList />} />
        <Route path="/tours/:tourId" element={<TourEditor />} />
        <Route path="/tours/:tourId/manage" element={<TourManage />} />
        <Route path="/tours/:tourId/viewer" element={<Suspense fallback={<div className="loading-screen">Loading viewer…</div>}><TourViewer /></Suspense>} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
</AuthProvider></BrowserRouter></React.StrictMode>);
