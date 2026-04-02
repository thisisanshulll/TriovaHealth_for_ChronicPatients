import { AlertTriangle } from 'lucide-react';

export function UrgencyBadge({ value }: { value?: string }) {
  const normalized = (value || 'routine').toLowerCase();
  const styles =
    normalized === 'emergency'
      ? 'bg-red-100 text-red-700 border-red-200'
      : normalized === 'urgent'
        ? 'bg-amber-100 text-amber-700 border-amber-200'
        : 'bg-emerald-100 text-emerald-700 border-emerald-200';

  const label =
    normalized === 'emergency' ? 'Emergency' : normalized === 'urgent' ? 'Urgent' : 'Routine';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${styles}`}>
      <AlertTriangle size={12} />
      {label}
    </span>
  );
}
