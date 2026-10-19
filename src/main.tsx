import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { tokenFromPath } from './lib/docLinks';

// A trainer's private link (/t/<token>) opens a small form with no login (TrainerLinkPage.tsx).
const TrainerLinkPage = lazy(() => import('./components/TrainerLinkPage'));
const trainerToken = window.location.pathname.match(/^\/t\/([a-f0-9]{32})\/?$/)?.[1];
// A client's quotation or course outline link (/q/<token>, /o/<token>) opens it as a web page (DocLinkPage.tsx).
const DocLinkPage = lazy(() => import('./components/DocLinkPage'));
const docToken = tokenFromPath(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {trainerToken ? (
      <Suspense fallback={null}><TrainerLinkPage token={trainerToken} /></Suspense>
    ) : docToken ? (
      <Suspense fallback={null}><DocLinkPage token={docToken} /></Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
