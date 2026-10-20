// Photos for the teambuilding proposal PDF (2026-10-19). The PDF is drawn in the browser from a picture of the
// page, and a browser may only use a photo in that picture when the photo's server allows it (CORS), which
// Firebase Storage doesn't by default. So the browser asks the CRM server for the photo instead: the server
// reads it with its own access and hands it back. Only logged-in team members, and only our own photos/ folder.

import type { Express } from 'express';
import { getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import firebaseConfig from './firebase-applet-config.json';
import { UserError, admin, callerFrom, route } from './serverAuth';

const BUCKET = String((firebaseConfig as any).storageBucket || '');

// The storage path inside a Firebase download link, if it's one of our photos.
export function photoPath(url: string): string {
  const m = String(url || '').match(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/);
  if (!m || m[1] !== BUCKET) return '';
  const path = decodeURIComponent(m[2]);
  // Also a trainer's photo uploaded from their own profile link (2026-10-20).
  return /^photos\/(activities|trainers|venues|covers)\/[A-Za-z0-9_.-]+$/.test(path) || /^trainer_uploads\/[a-f0-9]{32}\/photo_[0-9]+\.jpg$/.test(path) ? path : '';
}

export function registerPhotoRoutes(app: Express) {
  app.post('/api/photos/get', route(async req => {
    await callerFrom(req);
    const urls: string[] = (Array.isArray(req.body?.urls) ? req.body.urls : []).slice(0, 40).map(String);
    admin();
    const bucket = getStorage(getApps()[0]).bucket(BUCKET);
    const out: Record<string, string> = {};
    for (const url of urls) {
      const path = photoPath(url);
      if (!path) continue;
      try {
        const [buf] = await bucket.file(path).download();
        if (buf.length > 8 * 1024 * 1024) continue;
        out[url] = `data:image/jpeg;base64,${buf.toString('base64')}`;
      } catch { /* missing or no access: the PDF just shows no photo there */ }
    }
    if (urls.length && !Object.keys(out).length && urls.some(u => photoPath(u))) {
      throw new UserError(503, 'photos-unreadable', "The photos couldn't be read for the PDF. Try again in a minute.");
    }
    return { photos: out };
  }));
}
