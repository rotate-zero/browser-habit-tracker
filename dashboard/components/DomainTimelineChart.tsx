'use client';

// Hours formatted as 12-hour labels: 12a, 1a, 2a ... 12p, 1p ...
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return '12a';
  if (i < 12) return `${i}a`;
  if (i === 12) return '12p';
  return `${i - 12}p`;
});

export type HeatmapCell = {
  domain: string;
  hour: number;
  minutes: number;
};

export type DomainTimelineData = {
  domains: string[];
  data: HeatmapCell[];
};

// Square-root scale so low values are still visible while
// high values don't monopolise the top of the range.
function cellColor(minutes: number, maxMinutes: number): string {
  if (minutes <= 0 || maxMinutes <= 0) return 'rgba(39,39,42,0.4)';
  const intensity = Math.sqrt(minutes / maxMinutes);
  return `rgba(99,102,241,${(0.12 + intensity * 0.88).toFixed(2)})`;
}

export default function DomainTimelineChart({
  data,
  loading,
}: {
  data: DomainTimelineData | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  if (!data || data.domains.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-zinc-500">
        No data for this period.
      </div>
    );
  }

  // Build domain → hour → minutes lookup
  const lookup: Record<string, Record<number, number>> = {};
  let maxMinutes = 0;

  for (const domain of data.domains) {
    lookup[domain] = {};
    for (let h = 0; h < 24; h++) lookup[domain][h] = 0;
  }
  for (const cell of data.data) {
    if (!lookup[cell.domain]) lookup[cell.domain] = {};
    lookup[cell.domain][cell.hour] = cell.minutes;
    if (cell.minutes > maxMinutes) maxMinutes = cell.minutes;
  }

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 580 }}>

        {/* Hour labels -- show every 3rd to avoid crowding */}
        <div className="mb-1 flex">
          <div className="w-32 shrink-0" />
          {HOUR_LABELS.map((label, i) => (
            <div
              key={i}
              className="flex-1 text-center text-[10px] text-zinc-600"
            >
              {i % 3 === 0 ? label : ''}
            </div>
          ))}
        </div>

        {/* One row per domain */}
        {data.domains.map((domain) => (
          <div key={domain} className="mb-1 flex items-center">
            <div
              className="w-32 shrink-0 truncate pr-2 text-right text-xs text-zinc-400"
              title={domain}
            >
              {domain}
            </div>

            {Array.from({ length: 24 }, (_, hour) => {
              const mins = lookup[domain]?.[hour] ?? 0;
              const label =
                mins > 0
                  ? `${domain}  ${HOUR_LABELS[hour]}: ${Math.round(mins)}m`
                  : `${domain}  ${HOUR_LABELS[hour]}: no activity`;

              return (
                <div key={hour} className="flex-1 px-px">
                  <div
                    className="h-7 w-full rounded-sm"
                    style={{ background: cellColor(mins, maxMinutes) }}
                    title={label}
                  />
                </div>
              );
            })}
          </div>
        ))}

        {/* Colour legend */}
        <div className="mt-3 flex items-center justify-end gap-1.5">
          <span className="text-[10px] text-zinc-600">Less</span>
          {[0.12, 0.35, 0.55, 0.75, 1.0].map((alpha) => (
            <div
              key={alpha}
              className="h-3 w-5 rounded-sm"
              style={{ background: `rgba(99,102,241,${alpha})` }}
            />
          ))}
          <span className="text-[10px] text-zinc-600">More</span>
        </div>
      </div>
    </div>
  );
}
