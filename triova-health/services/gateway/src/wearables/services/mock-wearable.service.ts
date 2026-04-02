import { pool } from '@triova/shared';

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function gaussian(mean: number, std: number) {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * std;
}

export async function syncMockReading(patientId: string) {
  const hour = new Date().getHours();
  const night = hour >= 23 || hour < 7;
  const steps = night ? 0 : Math.max(0, Math.round(gaussian(7000, 2000)));
  const hr = Math.round(gaussian(night ? 62 : 72, 8));
  const spo2 = Math.round(gaussian(97, 1.5));
  const sys = Math.round(gaussian(118, 10));
  const dia = Math.round(gaussian(76, 6));
  const temp = Number(gaussian(36.8, 0.3).toFixed(2));
  const sleep = night ? Number(gaussian(7, 0.5).toFixed(1)) : null;
  const stress = Math.min(100, Math.max(0, Math.round(gaussian(35, 15))));

  const r = await pool.query(
    `INSERT INTO wearable_data (patient_id, recorded_at, heart_rate, spo2, blood_pressure_systolic, blood_pressure_diastolic,
      temperature_celsius, steps, sleep_hours, stress_level, data_source)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, 'mock')
     ON CONFLICT (patient_id, recorded_at) DO UPDATE SET heart_rate = EXCLUDED.heart_rate
     RETURNING *`,
    [patientId, hr, spo2, sys, dia, temp, steps, sleep, stress]
  );
  return { synced_at: new Date().toISOString(), data_point: r.rows[0] };
}

export async function latest(patientId: string) {
  const r = await pool.query(
    `SELECT * FROM wearable_data WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
    [patientId]
  );
  const w = r.rows[0];
  if (!w) return { vitals: {}, recorded_at: null };
  return {
    vitals: {
      heart_rate: w.heart_rate,
      spo2: w.spo2,
      bp_systolic: w.blood_pressure_systolic,
      bp_diastolic: w.blood_pressure_diastolic,
      temperature: w.temperature_celsius,
      steps: w.steps,
      sleep_hours: w.sleep_hours,
      stress_level: w.stress_level,
    },
    recorded_at: w.recorded_at,
  };
}

export async function history(
  patientId: string,
  q: { metric?: string; from_date?: string; to_date?: string; interval?: string }
) {
  const metric = q.metric || 'heart_rate';
  const colMap: Record<string, string> = {
    heart_rate: 'heart_rate',
    spo2: 'spo2',
    bp_systolic: 'blood_pressure_systolic',
    bp_diastolic: 'blood_pressure_diastolic',
    temperature: 'temperature_celsius',
    steps: 'steps',
    sleep_hours: 'sleep_hours',
    stress_level: 'stress_level',
  };
  const col = colMap[metric] || 'heart_rate';
  const r = await pool.query(
    `SELECT recorded_at AS timestamp, ${col}::float AS value FROM wearable_data
     WHERE patient_id = $1
     AND ($2::timestamptz IS NULL OR recorded_at >= $2::timestamptz)
     AND ($3::timestamptz IS NULL OR recorded_at <= $3::timestamptz)
     AND ${col} IS NOT NULL ORDER BY recorded_at`,
    [patientId, q.from_date || null, q.to_date || null]
  );
  return { data: r.rows, metric };
}

export async function manualReading(
  patientId: string,
  body: Record<string, number | undefined>
) {
  const r = await pool.query(
    `INSERT INTO wearable_data (patient_id, recorded_at, heart_rate, spo2, blood_pressure_systolic, blood_pressure_diastolic,
      temperature_celsius, steps, sleep_hours, stress_level, data_source)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, 'manual') RETURNING *`,
    [
      patientId,
      body.heart_rate ?? null,
      body.spo2 ?? null,
      body.bp_systolic ?? null,
      body.bp_diastolic ?? null,
      body.temperature ?? null,
      body.steps ?? null,
      body.sleep_hours ?? null,
      body.stress_level ?? null,
    ]
  );
  return { reading: r.rows[0] };
}

export async function simulateAnomaly(patientId: string, metric: string, severity: string) {
  const val =
    metric === 'heart_rate'
      ? severity === 'severe'
        ? 160
        : 120
      : metric === 'spo2'
        ? severity === 'severe'
          ? 85
          : 92
        : 100;
  const col =
    metric === 'heart_rate' ? 'heart_rate' : metric === 'spo2' ? 'spo2' : 'stress_level';
  const r = await pool.query(
    `INSERT INTO wearable_data (patient_id, recorded_at, ${col}, data_source) VALUES ($1, NOW(), $2, 'mock') RETURNING *`,
    [patientId, val]
  );
  return { reading: r.rows[0] };
}
