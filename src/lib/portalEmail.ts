import { Auth, sendPasswordResetEmail } from 'firebase/auth';
import { PORTAL_PATH } from './trainerPortal';

// Firebase's own "reset your password" email for a trainer portal login (2026-10-21): the first "choose your
// password" email when Admin gives access, and "Forgot password" on the portal. It sends the trainer back to
// the portal afterwards when this website is on Firebase's list of allowed websites; otherwise without that.
export async function sendPortalPasswordEmail(auth: Auth, email: string) {
  try {
    await sendPasswordResetEmail(auth, email, { url: `${window.location.origin}${PORTAL_PATH}` });
  } catch (e: any) {
    if (/continue-uri|unauthorized-domain/.test(String(e?.code || ''))) await sendPasswordResetEmail(auth, email);
    else throw e;
  }
}
