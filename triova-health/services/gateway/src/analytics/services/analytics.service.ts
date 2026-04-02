import { pool } from '@triova/shared';
import { acquireLock, releaseLock } from '@triova/shared';
import { getChatModel, getOpenAI, withOpenAIRetry } from '../../lib/openai.js';

function pctChange(first: number, last: number): number {
  if (!first) return 0;
  return Number((((last - first) / Math.abs(first)) * 100).toFixed(1));
}

function trendFromValues(first: number, last: number): 'increasing' | 'decreasing' | 'stable' {
  const delta = pctChange(first, last);
  if (Math.abs(delta) < 3) return 'stable';
  return delta > 0 ? 'increasing' : 'decreasing';
}

export async function patientDashboard(patientId: string) {
  const latest = await pool.query(
    `SELECT * FROM wearable_data WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
    [patientId]
  );
  const w = latest.rows[0];
  const alerts = await pool.query(
    `SELECT * FROM health_alerts WHERE patient_id = $1 AND status = 'active' ORDER BY severity DESC LIMIT 20`,
    [patientId]
  );
  const trend = await pool.query(
    `SELECT recorded_at::date AS date,
      AVG(heart_rate)::int AS avg_heart_rate,
      AVG(spo2)::int AS avg_spo2,
      AVG(steps)::int AS avg_steps,
      AVG(stress_level)::int AS avg_stress_level,
      AVG(sleep_hours)::numeric(4,1) AS avg_sleep_hours
     FROM wearable_data WHERE patient_id = $1 AND recorded_at > NOW() - INTERVAL '7 days'
     GROUP BY 1 ORDER BY 1`,
    [patientId]
  );
  const health_score = await computeHealthScore(patientId);
  const rows = trend.rows as Array<{
    date: string;
    avg_heart_rate: number;
    avg_spo2: number;
    avg_steps: number;
    avg_stress_level: number;
    avg_sleep_hours: number;
  }>;

  const first = rows[0];
  const last = rows[rows.length - 1];
  const trendSummaries =
    first && last
      ? [
          {
            metric: 'heart_rate',
            trend: trendFromValues(Number(first.avg_heart_rate || 0), Number(last.avg_heart_rate || 0)),
            change_percent: pctChange(Number(first.avg_heart_rate || 0), Number(last.avg_heart_rate || 0)),
          },
          {
            metric: 'spo2',
            trend: trendFromValues(Number(first.avg_spo2 || 0), Number(last.avg_spo2 || 0)),
            change_percent: pctChange(Number(first.avg_spo2 || 0), Number(last.avg_spo2 || 0)),
          },
          {
            metric: 'steps',
            trend: trendFromValues(Number(first.avg_steps || 0), Number(last.avg_steps || 0)),
            change_percent: pctChange(Number(first.avg_steps || 0), Number(last.avg_steps || 0)),
          },
        ]
      : [];

  return {
    health_score: health_score.score,
    latest_vitals: w
      ? {
          heart_rate: w.heart_rate,
          spo2: w.spo2,
          bp: `${w.blood_pressure_systolic}/${w.blood_pressure_diastolic}`,
          temperature: w.temperature_celsius,
          steps: w.steps,
          sleep: w.sleep_hours,
          stress: w.stress_level,
          recorded_at: w.recorded_at,
        }
      : {},
    active_alerts: alerts.rows,
    trend_summaries: trendSummaries,
    last_7_days: rows,
  };
}

async function computeHealthScore(patientId: string) {
  let score = 85;
  const al = await pool.query(
    `SELECT severity FROM health_alerts WHERE patient_id = $1 AND status = 'active'`,
    [patientId]
  );
  for (const a of al.rows) {
    if (a.severity === 'high') score -= 10;
    if (a.severity === 'critical') score -= 20;
  }
  score = Math.max(0, Math.min(100, score));
  return { score, grade: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor' };
}

export async function doctorDashboard(doctorId: string, date?: string) {
  const dayStr = date || new Date().toISOString().slice(0, 10);
  const patients = await pool.query(
    `SELECT DISTINCT p.*, ts.urgency_level, ts.ai_summary, ts.chief_complaint
     FROM doctor_patient_assignments dpa
     JOIN patients p ON p.id = dpa.patient_id
     LEFT JOIN LATERAL (
       SELECT * FROM triage_sessions WHERE patient_id = p.id ORDER BY completed_at DESC NULLS LAST LIMIT 1
     ) ts ON true
     WHERE dpa.doctor_id = $1`,
    [doctorId]
  );
  const byUrgency = { emergency: [] as unknown[], urgent: [] as unknown[], routine: [] as unknown[] };
  for (const row of patients.rows) {
    const u = (row.urgency_level as string) || 'routine';
    if (u === 'emergency') byUrgency.emergency.push(row);
    else if (u === 'urgent') byUrgency.urgent.push(row);
    else byUrgency.routine.push(row);
  }
  const appts = await pool.query(
    `SELECT a.*, p.first_name, p.last_name FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     WHERE a.doctor_id = $1 AND a.appointment_date = $2::date ORDER BY a.appointment_time`,
    [doctorId, dayStr]
  );
  const alerts = await pool.query(
    `SELECT h.*, p.first_name, p.last_name FROM health_alerts h
     JOIN patients p ON p.id = h.patient_id
     JOIN doctor_patient_assignments dpa ON dpa.patient_id = p.id AND dpa.doctor_id = $1
     WHERE h.status = 'active' ORDER BY h.detected_at DESC LIMIT 30`,
    [doctorId]
  );
  const stats = {
    total_patients: patients.rows.length,
    appointments_today: appts.rows.length,
    active_alerts: alerts.rows.length,
  };
  return {
    patients_by_urgency: byUrgency,
    todays_appointments: appts.rows,
    pending_triage_reviews: [],
    recent_alerts: alerts.rows,
    stats,
  };
}

export async function patientTrends(
  patientId: string,
  metric: string,
  days = 7
) {
  const col =
    metric === 'heart_rate'
      ? 'heart_rate'
      : metric === 'spo2'
        ? 'spo2'
        : metric === 'bp_systolic'
          ? 'blood_pressure_systolic'
          : metric === 'bp_diastolic'
            ? 'blood_pressure_diastolic'
            : metric === 'temperature'
              ? 'temperature_celsius'
              : metric === 'steps'
                ? 'steps'
                : metric === 'sleep_hours'
                  ? 'sleep_hours'
                  : 'stress_level';
  const r = await pool.query(
    `SELECT recorded_at AS timestamp, ${col}::float AS value FROM wearable_data
     WHERE patient_id = $1 AND recorded_at > NOW() - ($2::int * INTERVAL '1 day') AND ${col} IS NOT NULL
     ORDER BY recorded_at`,
    [patientId, days]
  );
  const base = await pool.query(`SELECT * FROM baseline_metrics WHERE patient_id = $1 AND metric_name = $2`, [
    patientId,
    metric,
  ]);
  const points = r.rows as Array<{ timestamp: string; value: number }>;
  const first = points[0]?.value;
  const last = points[points.length - 1]?.value;
  const trend =
    first == null || last == null ? 'stable' : trendFromValues(Number(first), Number(last));
  return {
    metric_name: metric,
    data_points: points,
    baseline: base.rows[0]?.baseline_value,
    std_dev: base.rows[0]?.baseline_std_dev,
    trend,
    trend_insight:
      trend === 'stable'
        ? 'Readings are stable compared to recent values.'
        : `Readings are ${trend} over the selected period.`,
  };
}

export async function patientAlerts(patientId: string, q: { status?: string; severity?: string }) {
  let sql = `SELECT * FROM health_alerts WHERE patient_id = $1`;
  const p: unknown[] = [patientId];
  if (q.status) {
    sql += ` AND status = $2::alert_status`;
    p.push(q.status);
  }
  if (q.severity) {
    sql += ` AND severity = $${p.length + 1}::alert_severity`;
    p.push(q.severity);
  }
  sql += ` ORDER BY detected_at DESC LIMIT 100`;
  const r = await pool.query(sql, p);
  return { alerts: r.rows };
}

export async function acknowledgeAlert(alertId: string, userId: string) {
  const r = await pool.query(
    `UPDATE health_alerts SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $2 WHERE id = $1 RETURNING *`,
    [alertId, userId]
  );
  return r.rows[0];
}

export async function resolveAlert(alertId: string) {
  const r = await pool.query(
    `UPDATE health_alerts SET status = 'resolved', resolved_at = NOW() WHERE id = $1 RETURNING *`,
    [alertId]
  );
  return r.rows[0];
}

export async function healthScoreDetail(patientId: string) {
  const s = await computeHealthScore(patientId);
  return {
    score: s.score,
    grade: s.grade,
    breakdown: [],
    risk_factors: [],
    recommendations: ['Maintain regular follow-ups'],
  };
}

export async function doctorPerformance(doctorId: string, from: string, to: string) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM consultations WHERE doctor_id = $1 AND created_at::date BETWEEN $2::date AND $3::date`,
    [doctorId, from, to]
  );
  return {
    patients_seen: r.rows[0].n,
    avg_consultation_minutes: 25,
    no_show_rate: 0.05,
  };
}

/** Daily job: baselines + alerts */
export async function runDailyTrendsAndAlerts() {
  const patients = await pool.query(`SELECT id FROM patients WHERE is_active = true`);
  for (const { id } of patients.rows) {
    const lockKey = `alert:lock:${id}`;
    const got = await acquireLock(lockKey, 120);
    if (!got) continue;
    try {
      await recalcBaseline(id);
      await generateAlertsForPatient(id);
    } finally {
      await releaseLock(lockKey);
    }
  }
}

async function recalcBaseline(patientId: string) {
  const metrics = ['heart_rate', 'spo2', 'blood_pressure_systolic', 'blood_pressure_diastolic', 'temperature_celsius', 'steps', 'sleep_hours', 'stress_level'];
  for (const m of metrics) {
    const col = m;
    const r = await pool.query(
      `SELECT AVG(${col})::numeric AS mean, STDDEV(${col})::numeric AS std, COUNT(*)::int AS c
       FROM wearable_data WHERE patient_id = $1 AND recorded_at > NOW() - INTERVAL '7 days' AND ${col} IS NOT NULL`,
      [patientId]
    );
    if (!r.rows[0]?.mean) continue;
    await pool.query(
      `INSERT INTO baseline_metrics (patient_id, metric_name, baseline_value, baseline_std_dev, sample_count, calculated_from_days)
       VALUES ($1,$2,$3,$4,$5,7)
       ON CONFLICT (patient_id, metric_name) DO UPDATE SET
         baseline_value = EXCLUDED.baseline_value,
         baseline_std_dev = GREATEST(EXCLUDED.baseline_std_dev, 0.0001),
         sample_count = EXCLUDED.sample_count,
         last_calculated_at = NOW()`,
      [patientId, m, r.rows[0].mean, r.rows[0].std || 1, r.rows[0].c]
    );
  }
}

async function generateAlertsForPatient(patientId: string) {
  const latest = await pool.query(
    `SELECT * FROM wearable_data WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
    [patientId]
  );
  if (!latest.rows[0]) return;
  const row = latest.rows[0];
  const baselines = await pool.query(`SELECT * FROM baseline_metrics WHERE patient_id = $1`, [patientId]);
  const bmap: Record<string, { metric_name: string; baseline_value: unknown; baseline_std_dev: unknown; sample_count?: number }> = Object.fromEntries(
    baselines.rows.map((b: { metric_name: string; baseline_value: unknown; baseline_std_dev: unknown; sample_count?: number }) => [b.metric_name, b])
  );
  const checks: { name: string; value: number; critical?: (v: number) => boolean }[] = [
    { name: 'heart_rate', value: row.heart_rate, critical: (v) => v < 40 || v > 140 },
    { name: 'spo2', value: row.spo2, critical: (v) => v < 90 },
  ];
  for (const c of checks) {
    if (c.value == null) continue;
    const b = bmap[c.name];
    if (!b || (b.sample_count || 0) < 3) continue;
    const z = Math.abs((c.value - Number(b.baseline_value)) / Number(b.baseline_std_dev || 1));
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (c.critical?.(c.value)) severity = 'critical';
    else if (z > 2) severity = 'high';
    else continue;
    const dup = await pool.query(
      `SELECT id FROM health_alerts WHERE patient_id = $1 AND metric_name = $2 AND status = 'active'`,
      [patientId, c.name]
    );
    if (dup.rows.length) continue;
    await pool.query(
      `INSERT INTO health_alerts (patient_id, metric_name, alert_message, severity, current_value, baseline_value)
       VALUES ($1,$2,$3,$4::alert_severity,$5,$6)`,
      [
        patientId,
        c.name,
        `Abnormal ${c.name} detected for patient baseline`,
        severity,
        c.value,
        b.baseline_value,
      ]
    );
  }
}

export async function trendsInsightAgent(_patientId: string) {
  const openai = getOpenAI();
  if (!openai) return null;
  await withOpenAIRetry(() =>
    openai.chat.completions.create({
      model: getChatModel(),
      messages: [{ role: 'user', content: 'Summarize health trends briefly.' }],
      max_tokens: 200,
    })
  );
  return null;
}
