import axios from 'axios';

async function verify() {
  const api = axios.create({ baseURL: 'http://127.0.0.1:3000/api' });
  try {
    const loginRes = await api.post('/auth/login', { 
      email: 'dr.sharma@triova.health', 
      password: 'Doctor@123' 
    });
    
    // The backend returns { profile: { id: ... }, ... }
    const token = loginRes.data.tokens.accessToken;
    const docId = loginRes.data.profile.id;
    
    console.log('Login successful. Doc ID:', docId);
    
    const dashRes = await api.get(`/analytics/doctor/${docId}/dashboard`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('Dashboard Data Status: OK');
    console.log('Urgency Counts:', {
      emergency: dashRes.data.patients_by_urgency.emergency.length,
      urgent: dashRes.data.patients_by_urgency.urgent.length,
      routine: dashRes.data.patients_by_urgency.routine.length,
    });
    console.log('Stats:', dashRes.data.stats);
    
    if (dashRes.data.patients_by_urgency.urgent.length > 0) {
      console.log('Sample Patient in Urgent:', dashRes.data.patients_by_urgency.urgent[0].first_name);
    }
    
  } catch (e: any) {
    console.error('Verification failed:', e.response?.data || e.message);
  }
}

verify();
