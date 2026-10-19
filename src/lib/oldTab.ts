// A browser tab opened before an update of the CRM asks for the app's old files, which are gone after the
// update (Joel saw "Failed to fetch dynamically imported module" on 2026-10-19). These turn that into a
// plain message. Kept tiny and loaded with the app, so it works even when the other files can't load.

export const isOldTabError = (e: any) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload|ChunkLoadError|MIME type/i.test(String(e?.message || e));

export const APP_UPDATED_TEXT = 'The CRM was just updated. Save your work, then reload the page (press F5) and try again.';

export function appUpdatedError() {
  const err: any = new Error(APP_UPDATED_TEXT);
  err.appUpdated = true;
  return err;
}

// The message to show when a PDF couldn't be made.
export const pdfErrorText = (e: any) =>
  e?.appUpdated || isOldTabError(e) ? APP_UPDATED_TEXT
    : `The PDF couldn't be made (${e?.message || e}). Open Preview and use Print → Save as PDF instead.`;
