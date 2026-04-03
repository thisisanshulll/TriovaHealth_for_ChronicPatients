import $ from 'axios';
const api = $.create({ baseURL: 'http://localhost:3000/api' });
async function check() {
  const dLogin = await api.post('/auth/login', { email: 'dr.sharma@triova.health', password: 'Doctor@123' });
  const dToken = dLogin.data.access_token;
  const docId = dLogin.data.doctor_profile.id;
  const dAuth = { headers: { Authorization: 'Bearer ' + dToken } };
  const res = await api.get('/analytics/doctor/' + docId + '/dashboard', dAuth);
  console.log(JSON.stringify(res.data.patients_by_urgency, null, 2));
}
check().catch(console.error);
