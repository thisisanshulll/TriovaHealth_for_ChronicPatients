import { Request, Response } from 'express';
import { pool } from '../../shared/db/pool.js';
import { ok, err } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';

export const getPatientDashboard = async (req: Request, res: Response) => {
  try {
    const { patient_id } = req.params;
    const user = (req as any).user;

    if (user.patientId !== patient_id && user.role !== 'doctor') {
      return err(res, 'Forbidden', 403);
    }

    const latestVitals = await pool.query(
      `SELECT * FROM wearable_data WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [patient_id]
    );

    const alerts = await pool.query(
      `SELECT * FROM health_alerts WHERE patient_id = $1 AND status = 'active' ORDER BY detected_at DESC LIMIT 5`,
      [patient_id]
    );

    const last7Days = await pool.query(
      `SELECT DATE(recorded_at) as date, 
              AVG(heart_rate) as avg_heart_rate, AVG(spo2) as avg_spo2, 
              AVG(blood_pressure_systolic) as avg_bp_systolic
       FROM wearable_data 
       WHERE patient_id = $1 AND recorded_at > NOW() - INTERVAL '7 days'
       GROUP BY DATE(recorded_at) ORDER BY date`,
      [patient_id]
    );

    const healthScore = calculateHealthScore(latestVitals.rows[0], alerts.rows);

    return ok(res, {
      health_score: healthScore,
      latest_vitals: latestVitals.rows[0] || {},
      active_alerts: alerts.rows,
      last_7_days: last7Days.rows,
      trend_summaries: []
    });
  } catch (error) {
    logger.error('Get dashboard failed', { error });
    return err(res, 'Failed to get dashboard', 500);
  }
};

function calculateHealthScore(vitals: any, alerts: any[]): number {
  if (!vitals) return 75;
  
  let score = 100;
  
  if (vitals.heart_rate < 60 || vitals.heart_rate > 100) score -= 10;
  if (vitals.spo2 < 95) score -= 15;
  if (vitals.blood_pressure_systolic > 140 || vitals.blood_pressure_systolic < 90) score -= 10;
  if (vitals.stress_level > 70) score -= 10;
  
  alerts.forEach(alert => {
    if (alert.severity === 'high') score -= 10;
    if (alert.severity === 'critical') score -= 20;
  });

  return Math.max(0, score);
}

export const getPatientTrends = async (req: Request, res: Response) => {
  try {
    const { patient_id } = req.params;
    const { metric, days = 7 } = req.query;

    const validMetrics = ['heart_rate', 'spo2', 'blood_pressure_systolic', 'blood_pressure_diastolic', 'temperature', 'steps', 'sleep_hours', 'stress_level'];
    if (!metric || !validMetrics.includes(metric as string)) {
      return err(res, 'Invalid metric', 400);
    }

    const result = await pool.query(
      `SELECT recorded_at as timestamp, ${metric} as value 
       FROM wearable_data 
       WHERE patient_id = $1 AND recorded_at > NOW() - INTERVAL '${days} days'
       ORDER BY recorded_at`,
      [patient_id]
    );

    const baseline = await pool.query(
      `SELECT baseline_value, baseline_std_dev FROM baseline_metrics WHERE patient_id = $1 AND metric_name = $2`,
      [patient_id, metric]
    );

    return ok(res, {
      metric_name: metric,
      data_points: result.rows,
      baseline: baseline.rows[0]?.baseline_value || null,
      std_dev: baseline.rows[0]?.baseline_std_dev || 1,
      trend: 'stable'
    });
  } catch (error) {
    logger.error('Get trends failed', { error });
    return err(res, 'Failed to get trends', 500);
  }
};

export const getPatientAlerts = async (req: Request, res: Response) => {
  try {
    const { patient_id } = req.params;
    const { status, severity, limit = 20 } = req.query;

    let query = `SELECT * FROM health_alerts WHERE patient_id = $1`;
    const params: any[] = [patient_id];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }
    if (severity) {
      query += ` AND severity = $${params.length + 1}`;
      params.push(severity);
    }

    query += ` ORDER BY detected_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    return ok(res, { alerts: result.rows });
  } catch (error) {
    logger.error('Get alerts failed', { error });
    return err(res, 'Failed to get alerts', 500);
  }
};

export const acknowledgeAlert = async (req: Request, res: Response) => {
  try {
    const { alert_id } = req.params;
    const user = (req as any).user;

    const result = await pool.query(
      `UPDATE health_alerts SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $1 WHERE id = $2 RETURNING *`,
      [user.id, alert_id]
    );

    return ok(res, { alert: result.rows[0] });
  } catch (error) {
    logger.error('Acknowledge alert failed', { error });
    return err(res, 'Failed to acknowledge', 500);
  }
};

export const resolveAlert = async (req: Request, res: Response) => {
  try {
    const { alert_id } = req.params;

    const result = await pool.query(
      `UPDATE health_alerts SET status = 'resolved', resolved_at = NOW() WHERE id = $1 RETURNING *`,
      [alert_id]
    );

    return ok(res, { alert: result.rows[0] });
  } catch (error) {
    logger.error('Resolve alert failed', { error });
    return err(res, 'Failed to resolve', 500);
  }
};

export const getDoctorDashboard = async (req: Request, res: Response) => {
  try {
    const { doctor_id } = req.params;
    const { date } = req.query;

    const patientsByUrgency = await pool.query(
      `SELECT a.*, p.first_name, p.last_name, p.date_of_birth, p.gender,
              t.urgency_level as triage_urgency, t.ai_summary as triage_summary
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       LEFT JOIN triage_sessions t ON t.appointment_id = a.id
       WHERE a.doctor_id = $1 AND a.appointment_date = $2 AND a.status NOT IN ('cancelled', 'no_show')
       ORDER BY a.urgency DESC, a.queue_position ASC`,
      [doctor_id, date || new Date().toISOString().split('T')[0]]
    );

    const emergencies = patientsByUrgency.rows.filter(p => p.urgency === 'emergency');
    const urgents = patientsByUrgency.rows.filter(p => p.urgency === 'urgent');
    const routine = patientsByUrgency.rows.filter(p => p.urgency === 'routine');

    const recentAlerts = await pool.query(
      `SELECT ha.*, p.first_name, p.last_name FROM health_alerts ha
       JOIN patients p ON ha.patient_id = p.id
       WHERE ha.status = 'active' AND ha.detected_at > NOW() - INTERVAL '24 hours'
       ORDER BY ha.detected_at DESC LIMIT 10`
    );

    return ok(res, {
      patients_by_urgency: { emergency: emergencies, urgent: urgents, routine },
      todays_appointments: patientsByUrgency.rows,
      recent_alerts: recentAlerts.rows,
      stats: {
        total_patients: patientsByUrgency.rows.length,
        appointments_today: patientsByUrgency.rows.length,
        active_alerts: recentAlerts.rows.length
      }
    });
  } catch (error) {
    logger.error('Get doctor dashboard failed', { error });
    return err(res, 'Failed to get dashboard', 500);
  }
};

export const getHealthScore = async (req: Request, res: Response) => {
  try {
    const { patient_id } = req.params;

    const latestVitals = await pool.query(
      `SELECT * FROM wearable_data WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [patient_id]
    );

    const alerts = await pool.query(
      `SELECT severity FROM health_alerts WHERE patient_id = $1 AND status = 'active'`,
      [patient_id]
    );

    const score = calculateHealthScore(latestVitals.rows[0], alerts.rows);

    let grade = 'fair';
    if (score >= 90) grade = 'excellent';
    else if (score >= 75) grade = 'good';
    else if (score >= 60) grade = 'fair';
    else grade = 'poor';

    return ok(res, {
      score,
      grade,
      risk_factors: [],
      recommendations: score < 75 ? ['Consider consulting with your doctor', 'Monitor vitals more frequently'] : []
    });
  } catch (error) {
    logger.error('Get health score failed', { error });
    return err(res, 'Failed to get health score', 500);
  }
};
