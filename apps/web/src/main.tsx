import React from 'react';
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
import { TourViewer } from './features/viewer/TourViewer';

createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><AuthProvider>
  <Routes>
    <Route path="/sign-in" element={<AuthScreen mode="sign-in" />} />
    <Route path="/create-account" element={<AuthScreen mode="create-account" />} />
    <Route path="/forgot-password" element={<AuthScreen mode="forgot-password" />} />
    <Route element={<RequireAuth />}>
      <Route element={<AppShell />}>
        <Route index element={<TourList />} />
        <Route path="/tours/:tourId" element={<TourEditor />} />
        <Route path="/tours/:tourId/viewer" element={<TourViewer />} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
</AuthProvider></BrowserRouter></React.StrictMode>);
