'use client';

import { useState, useEffect, useCallback } from 'react';
import { getInsights, type InsightsData, type MetricRow } from '@/lib/api';

type Period = 'day' | 'week' | 'month';

const PERIODS: { key: Period; label: string; vsLabel: string }[] = [
  { key: 'day',   label: 'Today',      vsLabel: 'vs yesterday' },
  { key: 'week',  label: 'This Week',  vsLabel: 'vs last week' },
  { key: 'month', label: 'This Month', vsLabel: 'vs last month' },
];

function formatSeconds(s: number): string {
  if (s <= 0) return '0m';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function buildLookup(rows: MetricRow[], metricType: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.metric_type !== metricType) continue;
    out[r.dimension ?? '__total__'] = r.value_seconds;
  }
  return out;
}

function Delta({ current, previous, vsLabel }: { current: number; previous: number; vsLabel: string }) {
  if (previous === 0) return <span className="text-xs text-zinc-600">no prior data</span>;
  const diff = current - previous;
  const pct = Math.round(Math.abs(diff / previous) * 100);
  const up = diff >= 0;
  return (
    <span className={`text-xs ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? '↑' : '↓'} {formatSeconds(Math.abs(diff))} ({up ? '+' : '-'}{pct}%) {vsLabel}
    </span>
  );
}

function RankList({
  rows,
  metricType,
  prevLookup,
  vsLabel,
}: {
  rows: MetricRow[];
  metricType: string;
  prevLookup: Record<string, number>;
  vsLabel: string;
}) {
  const items = rows
    .filter((r) => r.metric_type === metricType && r.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

  if (items.length === 0) {
    return <p className="py-4 text-sm text-zinc-500">No data yet — run aggregate.py first.</p>;
  }

  return (
    <ul className="divide-y divide-zinc-800">
      {items.map((item) => {
        const key = item.dimension ?? '';
        const prev = prevLookup[key];
        const isNew = prev === undefined;
        return (
          <li key={key} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 font-mono text-xs text-zinc-400">
              {item.rank}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-100">{item.dimension}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-zinc-400">{formatSeconds(item.value_seconds)}</span>
                {isNew ? (
                  <span className="text-xs text-indigo-400">new in top {items.length}</span>
                ) : (
                  <Delta current={item.value_seconds} previous={prev} vsLabel={vsLabel} />
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function InsightsPage() {
  const [period, setPeriod] = useState<Period>('day');
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getInsights(p);
      setData(result);
    } catch (e) {
      setError('Could not load insights. Make sure aggregate.py has been run at least once.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(period); }, [period, fetchData]);

  const vsLabel = PERIODS.find((p) => p.key === period)?.vsLabel ?? '';

  const currentTotal = data?.current.find((r) => r.metric_type === 'total_usage');
  const prevTotal    = data?.previous.find((r) => r.metric_type === 'total_usage');
  const domainPrev   = data ? buildLookup(data.previous, 'domain_usage')   : {};
  const catPrev      = data ? buildLookup(data.previous, 'category_usage') : {};

  const fade = loading ? 'opacity-40' : 'opacity-100';

  return (
    <div>
      {/* Period selector */}
      <div className="mb-5 flex flex-wrap gap-2">
        {PERIODS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setPeriod(key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              period === key
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Total time card */}
      <div className={`mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5 transition-opacity ${fade}`}>
        <p className="mb-1 text-sm text-zinc-400">Total browsing time</p>
        <p className="font-mono text-3xl font-medium text-zinc-100">
          {currentTotal ? formatSeconds(currentTotal.value_seconds) : '—'}
        </p>
        {currentTotal && prevTotal && (
          <div className="mt-1.5">
            <Delta
              current={currentTotal.value_seconds}
              previous={prevTotal.value_seconds}
              vsLabel={vsLabel}
            />
          </div>
        )}
      </div>

      {/* Category + Domain breakdown */}
      <div className={`grid gap-4 sm:grid-cols-2 transition-opacity ${fade}`}>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-3 text-sm text-zinc-400">Top categories</p>
          {data ? (
            <RankList
              rows={data.current}
              metricType="category_usage"
              prevLookup={catPrev}
              vsLabel={vsLabel}
            />
          ) : (
            <p className="py-4 text-sm text-zinc-500">{loading ? 'Loading…' : '—'}</p>
          )}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-3 text-sm text-zinc-400">Top domains</p>
          {data ? (
            <RankList
              rows={data.current}
              metricType="domain_usage"
              prevLookup={domainPrev}
              vsLabel={vsLabel}
            />
          ) : (
            <p className="py-4 text-sm text-zinc-500">{loading ? 'Loading…' : '—'}</p>
          )}
        </div>
      </div>
    </div>
  );
}
