import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// A trainer's private link (/t/<token>) opens a small form with no login (TrainerLinkPage.tsx).
const TrainerLinkPage = lazy(() => import('./components/TrainerLinkPage'));
const trainerToken = window.location.pathname.match(/^\/t\/([a-f0-9]{32})\/?$/)?.[1];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {trainerToken ? (
      <Suspense fallback={null}><TrainerLinkPage token={trainerToken} /></Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
