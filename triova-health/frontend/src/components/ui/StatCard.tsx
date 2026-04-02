import { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  hint,
  hintNode,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  hintNode?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        {icon && <span className="text-triova-700">{icon}</span>}
      </div>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      {hintNode
        ? <div className="mt-1 text-xs">{hintNode}</div>
        : hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
