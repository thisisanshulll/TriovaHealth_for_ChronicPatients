import { Request, Response } from 'express';
import { pool } from '../../shared/db/pool.js';
import { ok, err } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';

function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateMockVitals(patientId: string, existing?: any): any {
  const baseline = existing || {
    heart_rate: 75,
    spo2: 97,
    bp_systolic: 120,
    bp_diastolic: 80,
    temperature: 36.6,
    steps: 7000,
    sleep_hours: 7,
    stress_level: 35
  };

  return {
    heart_rate: Math.max(40, Math.min(160, baseline.heart_rate + randomInRange(-10, 10))),
    spo2: Math.max(90, Math.min(100, baseline.spo2 + randomInRange(-3, 3))),
    blood_pressure_systolic: Math.max(80, Math.min(180, baseline.bp_systolic + randomInRange(-10, 10))),
    blood_pressure_diastolic: Math.max(50, Math.min(110, baseline.bp_diastolic + randomInRange(-8, 8))),
    temperature: +(Math.max(35, Math.min(39, baseline.temperature + (Math.random() - 0.5))).toFixed(1)),
    steps: Math.max(0, baseline.steps + randomInRange(-2000, 2000)),
    sleep_hours: +Math.max(4, Math.min(12, baseline.sleep_hours + (Math.random() - 0.5) * 2).toFixed(1)),
    stress_level: Math.max(0, Math.min(100, baseline.stress_level + randomInRange(-15, 15)))
  };
}

export const syncWearableData = async (req: Request, res: Response) => {
  try {
    const { patient_id } = req.params;
    const user = (req as any).user;

    if (user.patientId !== patient_id && user.role !== 'doctor') {
      return err(res, 'Forbidden', 403);
    }

    const existingBaselines = await pool.query(
      `SELECT metric_name, baseline_value FROM baseline_metrics WHERE patient_id = $1`,
      [patient_id]
    );

    const baselineObj: any = {};
    existingBaselines.rows.forEach(b => { baselineObj[b.metric_name] = b.baseline_value; });

    const vitals = generateMockVitals(patient_id, Object.keys(baselineObj).length > 0 ? baselineObj : undefined);

    const result = await pool.query(
      `INSERT INTO wearable_data (patient_id, recorded_at, heart_rate, spo2, blood_pressure_systolic, blood_pressure_diastolic, temperature, steps, sleep_hours, stress_level, data_source)
       VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, 'mock') RETURNING *`,
      [patient_id, vitals.heart_rate, vitals.spo2, vitals.blood_pressure_systolic, vitals.blood_pressure_diastolic, vitals.temperature, vitals.steps, vitals.sleep_hours, vitals.stress_level]
    );

    logger.info('Wearable data synced', { patientId: patient_id });

    return ok(res, { synced_at: new Date().toISOString(), data_point: result.rows[0] });
  } catch (error) {
    logger.error('Sync wearable failed', { error });
    return err(res, 'Failed to sync', 500);
  }
};

export const getLatestVitals = async (req: Request, res: Response) => {
  try {
    const { patient_id } = req.params;

    const result = await pool.query(
      `SELECT * FROM wearable_data WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [patient_id]
    );

    return ok(res, { 
      vitals: result.rows[0] || {},
      recorded_at: result.rows[0]?.recorded_at
    });
  } catch (error) {
    logger.error('Get latest vitals failed', { error });
    return err(res, 'Failed to get vitals', 500);
  }
};

export const getVitalsHistory = async (req: Request, res: Response) => {
  try {
    const { patient_id } = req.params;
    const { metric, from_date, to_date, interval = 'daily' } = req.query;

    const validMetrics = ['heart_rate', 'spo2', 'blood_pressure_systolic', 'blood_pressure_diastolic', 'temperature', 'steps', 'sleep_hours', 'stress_level'];
    
    let query = `SELECT recorded_at as timestamp, ${metric || 'heart_rate'} as value FROM wearable_data WHERE patient_id = $1`;
    const params: any[] = [patient_id];

    if (from_date) {
      query += ` AND recorded_at >= $${params.length + 1}`;
      params.push(from_date);
    }
    if (to_date) {
      query += ` AND recorded_at <= $${params.length + 1}`;
      params.push(to_date);
    }

    query += ` ORDER BY recorded_at`;

    const result = await pool.query(query, params);

    return ok(res, { 
      data: result.rows,
      metric: metric || 'heart_rate'
    });
  } catch (error) {
    logger.error('Get history failed', { error });
    return err(res, 'Failed to get history', 500);
  }
};

export const addManualReading = async (req: Request, res: Response) => {
  try {
    const { patient_id } = req.params;
    const { heart_rate, spo2, blood_pressure_systolic, blood_pressure_diastolic, temperature, steps, sleep_hours, stress_level } = req.body;

    const result = await pool.query(
      `INSERT INTO wearable_data (patient_id, recorded_at, heart_rate, spo2, blood_pressure_systolic, blood_pressure_diastolic, temperature, steps, sleep_hours, stress_level, data_source)
       VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, 'manual') RETURNING *`,
      [patient_id, heart_rate, spo2, blood_pressure_systolic, blood_pressure_diastolic, temperature, steps, sleep_hours, stress_level]
    );

    return ok(res, { reading: result.rows[0] }, 201);
  } catch (error) {
    logger.error('Add reading failed', { error });
    return err(res, 'Failed to add reading', 500);
  }
};

export const simulateAnomaly = async (req: Request, res: Response) => {
  try {
    const { patient_id } = req.params;
    const { metric, severity } = req.body;

    const anomalyValues: Record<string, { mild: number, severe: number }> = {
      heart_rate: { mild: 110, severe: 150 },
      spo2: { mild: 92, severe: 85 },
      blood_pressure_systolic: { mild: 160, severe: 190 },
      stress_level: { mild: 75, severe: 95 }
    };

    const value = anomalyValues[metric]?.[severity] || 100;

    const result = await pool.query(
      `INSERT INTO wearable_data (patient_id, recorded_at, ${metric}, data_source)
       VALUES ($1, NOW(), $2, 'mock') RETURNING *`,
      [patient_id, value]
    );

    return ok(res, { reading: result.rows[0] });
  } catch (error) {
    logger.error('Simulate anomaly failed', { error });
    return err(res, 'Failed to simulate', 500);
  }
};
