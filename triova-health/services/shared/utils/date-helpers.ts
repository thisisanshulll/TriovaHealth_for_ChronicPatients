export function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60 * 1000);
}

export function combineDateTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}`);
}

export function hoursUntilAppointment(appointmentDate: string, appointmentTime: string): number {
  const appt = combineDateTime(appointmentDate, appointmentTime);
  return (appt.getTime() - Date.now()) / (1000 * 60 * 60);
}
