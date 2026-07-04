'use client';

import { useState, useEffect, useCallback } from 'react';
import MetricCard from '@/components/MetricCard';
import CategoryChart from '@/components/CategoryChart';
import DomainChart from '@/components/DomainChart';
import DomainTimelineChart from '@/components/DomainTimelineChart';
import {
  getSummary,
  getCategories,
  getDomains,
  getDomainTimeline,
  type Summary,
  type CategoryStat,
  type DomainStat,
  type DomainTimelineData,
} from '@/lib/api';

type Period = 'week' | 'month' | 'quarter' | 'year' | 'all';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'year', label: 'This Year' },
  { key: 'all', label: 'All Time' },
];

const PERIOD_LABELS: Record<Period, string> = {
  week: 'last 7 days',
  month: 'this month',
  quarter: 'this quarter',
  year: 'this year',
  all: 'all time',
};

function getStartDate(period: Period): string | null {
  const now = new Date();
  switch (period) {
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d.toISOString().split('T')[0];
    }
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split('T')[0];
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      return new Date(now.getFullYear(), q * 3, 1)
        .toISOString()
        .split('T')[0];
    }
    case 'year':
      return new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
    case 'all':
      return null;
  }
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categories, setCategories] = useState<CategoryStat[]>([]);
  const [domains, setDomains] = useState<DomainStat[]>([]);
  const [timeline, setTimeline] = useState<DomainTimelineData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (p: Period) => {
    setLoading(true);
    const startDate = getStartDate(p);
    const [s, c, d, t] = await Promise.all([
      getSummary(startDate),
      getCategories(startDate),
      getDomains(startDate),
      getDomainTimeline(startDate),
    ]);
    setSummary(s);
    setCategories(c);
    setDomains(d);
    setTimeline(t);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData(period);
  }, [period, fetchData]);

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

      {/* Metric cards */}
      <div className={`mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 transition-opacity ${fade}`}>
        <MetricCard
          label={`Tracked, ${PERIOD_LABELS[period]}`}
          value={summary ? `${summary.tracked_hours}h` : '—'}
        />
        <MetricCard label="Top category" value={summary?.top_category ?? '—'} />
        <MetricCard
          label="Sessions today"
          value={summary ? String(summary.sessions_today) : '—'}
        />
        <MetricCard
          label="Pending review"
          value={summary ? String(summary.pending_review) : '—'}
        />
      </div>

      {/* Category donut / bar */}
      <div className={`mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5 transition-opacity ${fade}`}>
        <CategoryChart data={categories} />
      </div>

      {/* Domain totals */}
      <div className={`mb-4 grid gap-4 sm:grid-cols-2 transition-opacity ${fade}`}>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-2.5 text-sm text-zinc-400">Time by domain</p>
          <DomainChart data={domains} metric="hours" color="#378ADD" />
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-2.5 text-sm text-zinc-400">Sessions by domain</p>
          <DomainChart data={domains} metric="sessions" color="#1D9E75" />
        </div>
      </div>

      {/* Domain timeline heatmap */}
      <div className={`rounded-xl border border-zinc-800 bg-zinc-900 p-5 transition-opacity ${fade}`}>
        <p className="mb-4 text-sm text-zinc-400">
          Activity by hour · top 10 domains
          <span className="ml-2 text-xs text-zinc-600">(Dhaka time)</span>
        </p>
        <DomainTimelineChart data={timeline} loading={loading} />
      </div>
    </div>
  );
}
