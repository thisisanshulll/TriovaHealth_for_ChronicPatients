import { google } from 'googleapis';
import { pool } from '@triova/shared';

const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  redirectUri
);

export function getAuthUrl(): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    prompt: 'consent',
  });
}

export async function getTokens(code: string) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function saveGoogleTokens(userId: string, tokens: { access_token?: string | null; refresh_token?: string | null }) {
  await pool.query(
    `INSERT INTO user_google_tokens (user_id, access_token, refresh_token)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET access_token = COALESCE($2, access_token), refresh_token = COALESCE($3, refresh_token)`,
    [userId, tokens.access_token || null, tokens.refresh_token || null]
  );
}

export async function getGoogleTokens(userId: string): Promise<{ access_token?: string; refresh_token?: string } | null> {
  const r = await pool.query(
    `SELECT access_token, refresh_token FROM user_google_tokens WHERE user_id = $1`,
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

  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || undefined,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

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
    const startTime = new Date(`${appointmentDetails.date}T${appointmentDetails.time}:00`);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    await addEventToGoogleCalendar(doctorUserId, {
      summary: `Appointment with ${appointmentDetails.patientName}`,
      description: `Patient: ${appointmentDetails.patientName}\nChief Complaint: ${appointmentDetails.chiefComplaint || 'General consultation'}`,
      startTime,
      endTime,
    });

    return { synced: true };
  } catch (error) {
    console.error('Failed to sync to Google Calendar:', error);
    return { synced: false, error: 'Failed to sync to Google Calendar' };
  }
}