import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App and Auth
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Configure Google OAuth Provider with Calendar & Sheets/Drive scopes
export const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/calendar');
provider.addScope('https://www.googleapis.com/auth/calendar.events');
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/drive.file');

let cachedAccessToken: string | null = null;
let isSigningIn = false;

// Initialize Auth Listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      // Check if we already have the token cached. If not, the user needs to sign in again to get the OAuth token
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        // If logged in via Firebase but token is not in-memory (e.g. page reload), we can trigger quick sign-in or let them re-auth
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Sign in with Google Popup
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to retrieve Google OAuth access token from login');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Google Sign-In Error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Sign out
export const googleSignOut = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export const getCachedToken = () => cachedAccessToken;

// Parse date and time string to Google Calendar API start/end objects
function parseDateTime(dateStr: string, timeStr: string) {
  // If "All Day" or invalid time, return full-day event schema
  const isAllDay = !timeStr || timeStr.toLowerCase().includes('all day');
  if (isAllDay) {
    // End date is exclusive in Google Calendar API for full-day events
    const nextDay = new Date(dateStr);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split('T')[0];
    return {
      start: { date: dateStr },
      end: { date: nextDayStr }
    };
  }

  try {
    // Parse time like "10:00 AM", "02:30 PM", "11:00 AM", "10:00", etc.
    const cleanTime = timeStr.trim();
    const match = cleanTime.match(/^(\d+):(\d+)\s*(AM|PM)?$/i);
    let hour = 9;
    let minute = 0;
    
    if (match) {
      hour = parseInt(match[1], 10);
      minute = parseInt(match[2], 10);
      const ampm = match[3] ? match[3].toUpperCase() : null;
      if (ampm) {
        if (ampm === 'PM' && hour < 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;
      }
    } else {
      // Try fallback to standard Date parsing if it contains AM/PM but didn't match the regex exactly
      const lowerTime = cleanTime.toLowerCase();
      if (lowerTime.includes('pm')) {
        const h = parseInt(cleanTime, 10);
        if (h < 12) hour = h + 12;
        else hour = h;
      } else if (lowerTime.includes('am')) {
        const h = parseInt(cleanTime, 10);
        if (h === 12) hour = 0;
        else hour = h;
      } else {
        const h = parseInt(cleanTime, 10);
        if (!isNaN(h) && h >= 0 && h < 24) hour = h;
      }
    }

    const startHourStr = hour.toString().padStart(2, '0');
    const startMinuteStr = minute.toString().padStart(2, '0');
    // Using native local ISO datetime representation (no 'Z' or local timezone offset)
    // so Google Calendar interprets it strictly relative to the 'Asia/Kuala_Lumpur' parameter
    const startIso = `${dateStr}T${startHourStr}:${startMinuteStr}:00`;

    // Set end time (default to 1 hour later)
    let endHour = hour + 1;
    let endDateStr = dateStr;
    if (endHour >= 24) {
      endHour = endHour - 24;
      const d = new Date(dateStr);
      d.setDate(d.getDate() + 1);
      endDateStr = d.toISOString().split('T')[0];
    }
    const endHourStr = endHour.toString().padStart(2, '0');
    const endIso = `${endDateStr}T${endHourStr}:${startMinuteStr}:00`;

    return {
      start: {
        dateTime: startIso,
        timeZone: 'Asia/Kuala_Lumpur'
      },
      end: {
        dateTime: endIso,
        timeZone: 'Asia/Kuala_Lumpur'
      }
    };
  } catch (e) {
    console.error('Error parsing date/time for Google Calendar:', e);
    return {
      start: { date: dateStr },
      end: { date: dateStr }
    };
  }
}

// Sync event to Google Calendar
export const syncEventToGoogleCalendar = async (
  title: string,
  dateStr: string,
  timeStr: string,
  attendeeEmails: string[] = []
): Promise<any> => {
  const token = cachedAccessToken;
  if (!token) {
    throw new Error('User is not signed in to Google Calendar. Please sign in first.');
  }

  const timeSchema = parseDateTime(dateStr, timeStr);
  const eventBody = {
    summary: title,
    description: `Created via Next Academy Operations Portal.\nOriginally scheduled for ${timeStr} on ${dateStr}.`,
    ...timeSchema,
    attendees: attendeeEmails.map(email => ({ email })),
    reminders: {
      useDefault: true
    }
  };

  const response = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventBody)
    }
  );

  if (!response.ok) {
    const errorDetails = await response.text();
    console.error('Google Calendar API Error details:', errorDetails);
    throw new Error(`Google Calendar sync failed: ${response.statusText}`);
  }

  return await response.json();
};

// Sync quotation to Google Sheets
export const syncQuotationToGoogleSheet = async (
  quotation: any,
  repName: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> => {
  const token = cachedAccessToken;
  if (!token) {
    throw new Error('User is not signed in with Google. Please sign in first.');
  }

  // 1. Check if we already created a spreadsheet for NEXT Academy Quotations in localStorage
  let spreadsheetId = localStorage.getItem('next_academy_quotations_sheet_id');

  // If not, let's create a brand new tracking Spreadsheet
  if (!spreadsheetId) {
    const createResponse = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          title: 'NEXT Academy - Quotations Tracking Log'
        },
        sheets: [
          {
            properties: {
              title: 'Quotations Log',
              gridProperties: {
                frozenRowCount: 1
              }
            }
          }
        ]
      })
    });

    if (!createResponse.ok) {
      const errText = await createResponse.text();
      console.error('Failed to create sheet:', errText);
      throw new Error(`Google Sheets creation failed: ${createResponse.statusText}`);
    }

    const createdSheet = await createResponse.json();
    spreadsheetId = createdSheet.spreadsheetId;
    if (spreadsheetId) {
      localStorage.setItem('next_academy_quotations_sheet_id', spreadsheetId);
    }

    // Initialize headers
    const headers = [
      'Timestamp',
      'Ref Number',
      'Date',
      'Client Company',
      'ATTN',
      'Venue',
      'Training Program(s)',
      'Total Days',
      'SST Applied',
      'Total Amount (RM)',
      'Sales Representative'
    ];

    if (spreadsheetId) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'Quotations Log'!A1:K1?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          range: "'Quotations Log'!A1:K1",
          majorDimension: 'ROWS',
          values: [headers]
        })
      });
    }
  }

  // 2. Append the current quotation details
  const timestamp = new Date().toLocaleString();
  const programsStr = (quotation.items || []).map((it: any) => `${it.program} (${it.days} days)`).join(', ');
  const totalDays = (quotation.items || []).reduce((sum: number, it: any) => sum + (it.days || 0), 0);
  const subtotal = (quotation.items || []).reduce((sum: number, it: any) => sum + (it.totalFee || 0), 0);
  const sstAmount = quotation.applySST ? (subtotal * (quotation.sstRate || 8) / 100) : 0;
  const grandTotal = subtotal + sstAmount;

  const rowData = [
    timestamp,
    quotation.refNumber || 'N/A',
    quotation.date || 'N/A',
    quotation.company || 'N/A',
    quotation.attn || 'N/A',
    quotation.venue || 'N/A',
    programsStr || 'No programs added',
    totalDays,
    quotation.applySST ? `Yes (${quotation.sstRate || 8}%)` : 'No',
    grandTotal.toFixed(2),
    repName
  ];

  const appendResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'Quotations Log'!A:K:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        range: "'Quotations Log'!A:K",
        majorDimension: 'ROWS',
        values: [rowData]
      })
    }
  );

  if (!appendResponse.ok) {
    const errText = await appendResponse.text();
    console.error('Failed to append row to Google Sheets:', errText);
    // If append fails, maybe the spreadsheet was deleted in Google Drive. Let's reset the spreadsheet ID.
    localStorage.removeItem('next_academy_quotations_sheet_id');
    throw new Error(`Google Sheets append failed: ${appendResponse.statusText}. Resetting sheet reference. Please try again.`);
  }

  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  return { spreadsheetId: spreadsheetId!, spreadsheetUrl };
};
