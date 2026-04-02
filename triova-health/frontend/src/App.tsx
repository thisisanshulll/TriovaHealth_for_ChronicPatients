import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from '@/pages/auth/Login';
import Register from '@/pages/auth/Register';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import PatientDashboard from '@/pages/patient/Dashboard';
import DoctorDashboard from '@/pages/doctor/Dashboard';
import BookAppointment from '@/pages/patient/BookAppointment';
import Triage from '@/pages/patient/Triage';
import MedicalRecords from '@/pages/patient/MedicalRecords';
import MedicationReminders from '@/pages/patient/MedicationReminders';
import PatientDetail from '@/pages/doctor/PatientDetail';
import { DoctorLayout, PatientLayout } from '@/components/layout/RoleLayout';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<ProtectedRoute role="patient" />}>
          <Route path="/patient" element={<PatientLayout />}>
            <Route index element={<PatientDashboard />} />
            <Route path="book" element={<BookAppointment />} />
            <Route path="triage" element={<Triage />} />
            <Route path="records" element={<MedicalRecords />} />
            <Route path="medications" element={<MedicationReminders />} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute role="doctor" />}>
          <Route path="/doctor" element={<DoctorLayout />}>
            <Route index element={<DoctorDashboard />} />
            <Route path="patients/:patientId" element={<PatientDetail />} />
          </Route>
        </Route>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
