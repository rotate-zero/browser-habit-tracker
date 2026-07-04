export default function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-sm text-zinc-400">{label}</p>
      <p className="mt-1 font-mono text-2xl font-medium text-zinc-100">{value}</p>
    </div>
  );
}
