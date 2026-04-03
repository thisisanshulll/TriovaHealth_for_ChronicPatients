import { google } from 'googleapis';
import { pool } from '@triova/shared';

export function getOAuth2Client() {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://127.0.0.1:3000/api/auth/google/callback';
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

export function getAuthUrl(): string {
  return getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'
    ],
    prompt: 'consent',
  });
}

export async function getTokensAndProfile(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ auth: client, version: 'v2' });
  const userInfo = await oauth2.userinfo.get();
  return { tokens, userInfo: userInfo.data };
}

export async function saveGoogleTokens(userId: string, data: { tokens: any, userInfo: any }) {
  await pool.query(
    `INSERT INTO user_google_tokens (user_id, access_token, refresh_token, google_email, google_picture)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET 
       access_token = COALESCE($2, user_google_tokens.access_token), 
       refresh_token = COALESCE($3, user_google_tokens.refresh_token),
       google_email = EXCLUDED.google_email,
       google_picture = EXCLUDED.google_picture`,
    [userId, data.tokens.access_token || null, data.tokens.refresh_token || null, data.userInfo.email || null, data.userInfo.picture || null]
  );
}

export async function getGoogleTokens(userId: string): Promise<{ access_token?: string; refresh_token?: string; google_email?: string; google_picture?: string } | null> {
  const r = await pool.query(
    `SELECT access_token, refresh_token, google_email, google_picture FROM user_google_tokens WHERE user_id = $1`,
    [userId]
  );
  return r.rows[0] || null;
}

export async function addEventToGoogleCalendar(
  userId: string,
  eventDetails: {
    summary: string;
    description?: string;
    startTime: Date;
    endTime: Date;
    attendees?: string[];
  }
) {
  const tokens = await getGoogleTokens(userId);
  if (!tokens?.access_token) {
    throw new Error('Google Calendar not connected for this user');
  }

  const client = getOAuth2Client();
  client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || undefined,
  });

  const calendar = google.calendar({ version: 'v3', auth: client });

  const event = {
    summary: eventDetails.summary,
    description: eventDetails.description,
    start: {
      dateTime: eventDetails.startTime.toISOString(),
      timeZone: 'Asia/Kolkata',
    },
    end: {
      dateTime: eventDetails.endTime.toISOString(),
      timeZone: 'Asia/Kolkata',
    },
    attendees: eventDetails.attendees?.map((email) => ({ email })),
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 30 },
      ],
    },
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
    sendUpdates: 'all',
  });

  return response.data;
}

export async function syncAppointmentToDoctorCalendar(
  doctorUserId: string,
  appointmentDetails: {
    patientName: string;
    date: string;
    time: string;
    chiefComplaint?: string;
  }
) {
  try {
    const timeStr = appointmentDetails.time.slice(0, 5);
    const startTime = new Date(`${appointmentDetails.date}T${timeStr}:00`);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    await addEventToGoogleCalendar(doctorUserId, {
      summary: `Appointment with ${appointmentDetails.patientName}`,
      description: `Patient: ${appointmentDetails.patientName}\nChief Complaint: ${appointmentDetails.chiefComplaint || 'General consultation'}`,
      startTime,
      endTime,
    });

    return { synced: true };
  } catch (error: any) {
    console.error('Failed to sync to Google Calendar:', error?.response?.data || error);
    return { synced: false, error: 'Failed to sync to Google Calendar' };
  }
}