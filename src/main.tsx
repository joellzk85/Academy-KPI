import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { tokenFromPath } from './lib/docLinks';

// A trainer's private link (/t/<token>) opens a small form with no login (TrainerLinkPage.tsx).
const TrainerLinkPage = lazy(() => import('./components/TrainerLinkPage'));
const trainerToken = window.location.pathname.match(/^\/t\/([a-f0-9]{32})\/?$/)?.[1];
// A client's quotation or course outline link (/q/<token>, /o/<token>), or HR's training report link (/r/<token>),
// opens it as a web page (DocLinkPage.tsx).
const DocLinkPage = lazy(() => import('./components/DocLinkPage'));
const docToken = tokenFromPath(window.location.pathname);
// A client's teambuilding proposal link (/p/<token>) opens the proposal website (ProposalLinkPage.tsx, push B).
const ProposalLinkPage = lazy(() => import('./components/ProposalLinkPage'));
const proposalToken = window.location.pathname.match(/^\/p\/([a-f0-9]{32})\/?$/)?.[1];

// Accounts' link to a payment request (/pay/<token>): see it and click "Payment made" (PaymentLinkPage.tsx).
const PaymentLinkPage = lazy(() => import('./components/PaymentLinkPage'));
const paymentToken = window.location.pathname.match(/^\/pay\/([a-f0-9]{32})\/?$/)?.[1];

// A referrer's link (/ref/<token>): their bank details for the referral fee (ReferrerLinkPage.tsx, 2026-10-24).
const ReferrerLinkPage = lazy(() => import('./components/ReferrerLinkPage'));
const referrerToken = window.location.pathname.match(/^\/ref\/([a-f0-9]{32})\/?$/)?.[1];

// The head of department's 30-day check-in on a training report (/c/<token>, CheckinPage.tsx, 2026-10-27).
const CheckinPage = lazy(() => import('./components/CheckinPage'));
const checkinToken = window.location.pathname.match(/^\/c\/([a-f0-9]{32})\/?$/)?.[1];

// The trainer portal (/trainer): trainers with access log in by email (TrainerPortal.tsx, 2026-10-21).
const TrainerPortal = lazy(() => import('./components/TrainerPortal'));
const portalMatch = window.location.pathname.match(/^\/trainer(?:\/join\/([a-f0-9]{32}))?\/?$/);
const trainerPortal = !!portalMatch;
const portalInvite = portalMatch?.[1];   // an invite link: /trainer/join/<token>

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {trainerPortal ? (
      <Suspense fallback={null}><TrainerPortal inviteToken={portalInvite} /></Suspense>
    ) : checkinToken ? (
      <Suspense fallback={null}><CheckinPage token={checkinToken} /></Suspense>
    ) : referrerToken ? (
      <Suspense fallback={null}><ReferrerLinkPage token={referrerToken} /></Suspense>
    ) : paymentToken ? (
      <Suspense fallback={null}><PaymentLinkPage token={paymentToken} /></Suspense>
    ) : trainerToken ? (
      <Suspense fallback={null}><TrainerLinkPage token={trainerToken} /></Suspense>
    ) : proposalToken ? (
      <Suspense fallback={null}><ProposalLinkPage token={proposalToken} /></Suspense>
    ) : docToken ? (
      <Suspense fallback={null}><DocLinkPage token={docToken} /></Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
