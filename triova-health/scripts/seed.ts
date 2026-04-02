import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/triova_health' });

const DOCTOR = {
  email: 'dr.sharma@triova.health',
  password: 'Doctor@123',
  first_name: 'Priya',
  last_name: 'Sharma',
  specialization: 'General Medicine',
  license_number: 'MH-2024-001',
  phone: '+919876543211',
};

const PATIENTS = [
  {
    email: 'raj.kumar@example.com',
    password: 'Patient@123',
    first_name: 'Raj',
    last_name: 'Kumar',
    date_of_birth: '1985-03-15',
    gender: 'male',
    phone: '+919876543210',
    blood_group: 'B+',
  },
  {
    email: 'sita.devi@example.com',
    password: 'Patient@123',
    first_name: 'Sita',
    last_name: 'Devi',
    date_of_birth: '1990-07-22',
    gender: 'female',
    phone: '+919876543212',
    blood_group: 'O+',
  },
  {
    email: 'amit.singh@example.com',
    password: 'Patient@123',
    first_name: 'Amit',
    last_name: 'Singh',
    date_of_birth: '1978-11-01',
    gender: 'male',
    phone: '+919876543213',
    blood_group: 'A+',
  },
];

async function seed() {
  const hash = await bcrypt.hash(DOCTOR.password, 10);
  let doctorUserId: string;
  const exu = await pool.query(`SELECT id FROM users WHERE email = $1`, [DOCTOR.email]);
  if (exu.rows[0]) doctorUserId = exu.rows[0].id;
  else {
    const u = await pool.query(
      `INSERT INTO users (email, password_hash, role, is_verified) VALUES ($1,$2,'doctor',true) RETURNING id`,
      [DOCTOR.email, hash]
    );
    doctorUserId = u.rows[0].id;
  }

  let doctorId: string;
  const dex = await pool.query(`SELECT id FROM doctors WHERE user_id = $1`, [doctorUserId]);
  if (dex.rows[0]) doctorId = dex.rows[0].id;
  else {
    const d = await pool.query(
      `INSERT INTO doctors (user_id, first_name, last_name, phone, specialization, license_number, is_available)
       VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
      [doctorUserId, DOCTOR.first_name, DOCTOR.last_name, DOCTOR.phone, DOCTOR.specialization, DOCTOR.license_number]
    );
    doctorId = d.rows[0].id;
  }

  await pool.query(`DELETE FROM doctor_availability WHERE doctor_id = $1`, [doctorId]);
  for (let day = 1; day <= 5; day++) {
    await pool.query(
      `INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, is_active)
       VALUES ($1,$2,'09:00:00','17:00:00',30,true)`,
      [doctorId, day]
    );
  }

  for (const p of PATIENTS) {
    const ph = await bcrypt.hash(p.password, 10);
    let uid: string;
    const eu = await pool.query(`SELECT id FROM users WHERE email = $1`, [p.email]);
    if (eu.rows[0]) uid = eu.rows[0].id;
    else {
      const ur = await pool.query(
        `INSERT INTO users (email, password_hash, role, is_verified) VALUES ($1,$2,'patient',true) RETURNING id`,
        [p.email, ph]
      );
      uid = ur.rows[0].id;
    }

    let pid: string;
    const ep = await pool.query(`SELECT id FROM patients WHERE user_id = $1`, [uid]);
    if (ep.rows[0]) pid = ep.rows[0].id;
    else {
      const pr = await pool.query(
        `INSERT INTO patients (user_id, first_name, last_name, date_of_birth, gender, phone, blood_group)
         VALUES ($1,$2,$3,$4::date,$5::gender_type,$6,$7) RETURNING id`,
        [uid, p.first_name, p.last_name, p.date_of_birth, p.gender, p.phone, p.blood_group]
      );
      pid = pr.rows[0].id;
    }

    await pool.query(
      `INSERT INTO doctor_patient_assignments (doctor_id, patient_id, is_primary) VALUES ($1,$2,true)
       ON CONFLICT (doctor_id, patient_id) DO NOTHING`,
      [doctorId, pid]
    );

    const wc = await pool.query(`SELECT COUNT(*)::int AS c FROM wearable_data WHERE patient_id = $1`, [pid]);
    if (wc.rows[0].c > 10) continue;

    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h += 4) {
        const t = new Date();
        t.setDate(t.getDate() - d);
        t.setHours(h, 0, 0, 0);
        await pool.query(
          `INSERT INTO wearable_data (patient_id, recorded_at, heart_rate, spo2, blood_pressure_systolic, blood_pressure_diastolic, temperature_celsius, steps, sleep_hours, stress_level, data_source)
           VALUES ($1,$2,72,97,118,76,36.8,5000,7,30,'mock')
           ON CONFLICT (patient_id, recorded_at) DO NOTHING`,
          [pid, t.toISOString()]
        );
      }
    }
  }

  console.log('Seed complete. Doctor:', DOCTOR.email, ' / Patients:', PATIENTS.map((x) => x.email).join(', '));
  await pool.end();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
