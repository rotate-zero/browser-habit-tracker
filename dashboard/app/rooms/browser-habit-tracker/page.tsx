'use client';

import { useState, useEffect, useCallback } from 'react';
import MetricCard from '@/components/MetricCard';
import CategoryChart from '@/components/CategoryChart';
import DomainChart from '@/components/DomainChart';
import DomainTimelineChart from '@/components/DomainTimelineChart';
import CategoryTrendChart from '@/components/CategoryTrendChart';
import CategoryBundleChart from '@/components/CategoryBundleChart';
import {
  getSummary,
  getCategories,
  getDomains,
  getDomainTimeline,
  getCategoryTrend,
  type Summary,
  type CategoryStat,
  type DomainStat,
  type DomainTimelineData,
  type CategoryTrendData,
} from '@/lib/api';

type Period = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'year', label: 'This Year' },
  { key: 'all', label: 'All Time' },
];

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [offset, setOffset] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categories, setCategories] = useState<CategoryStat[]>([]);
  const [domains, setDomains] = useState<DomainStat[]>([]);
  const [timeline, setTimeline] = useState<DomainTimelineData | null>(null);
  const [trend, setTrend] = useState<CategoryTrendData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (p: Period, o: number) => {
    setLoading(true);
    // Trend chart doesn't exist for All Time -- there's no coherent set
    // of "prior all-times" to tile, so skip fetching it entirely rather
    // than asking the backend to reject it every time.
    const [s, c, d, t, tr] = await Promise.all([
      getSummary(p, o),
      getCategories(p, o),
      getDomains(p, o),
      getDomainTimeline(p, o),
      p === 'all' ? Promise.resolve(null) : getCategoryTrend(p, o),
    ]);
    setSummary(s);
    setCategories(c);
    setDomains(d);
    setTimeline(t);
    setTrend(tr);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData(period, offset);
  }, [period, offset, fetchData]);

  // Switching period type starts fresh at the current period rather than
  // carrying over an offset from a different timeframe's slide position.
  function selectPeriod(key: Period) {
    setPeriod(key);
    setOffset(0);
  }

  const canSlide = period !== 'all';
  const canGoBack = canSlide;
  const canGoForward = canSlide && offset > 0;

  const fallbackLabel = PERIODS.find((p) => p.key === period)?.label ?? '';
  const rangeLabel = summary?.period_label ?? fallbackLabel;

  const noData =
    !loading &&
    summary !== null &&
    summary.tracked_hours === 0 &&
    categories.length === 0 &&
    domains.length === 0;

  const fade = loading ? 'opacity-40' : 'opacity-100';

  return (
    <div>
      {/* Period selector */}
      <div className="mb-3 flex flex-wrap gap-2">
        {PERIODS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => selectPeriod(key)}
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

      {/* Slide controls */}
      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => canGoBack && setOffset((o) => o + 1)}
          disabled={!canGoBack}
          aria-label="Previous period"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-zinc-800"
        >
          &lt;
        </button>
        <span className="min-w-0 text-sm font-medium text-zinc-300">{rangeLabel}</span>
        <button
          type="button"
          onClick={() => canGoForward && setOffset((o) => Math.max(0, o - 1))}
          disabled={!canGoForward}
          aria-label="Next period"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-zinc-800"
        >
          &gt;
        </button>
      </div>

      {noData && (
        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
          No data available for this timeframe.
        </div>
      )}

      {/* Metric cards */}
      <div className={`mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 transition-opacity ${fade}`}>
        <MetricCard
          label={`Tracked, ${rangeLabel}`}
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

      {/* Top categories over time -- not shown for All Time, there's no
          coherent set of "prior all-times" to compare against */}
      {period !== 'all' && (
        <div className={`mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5 transition-opacity ${fade}`}>
          <CategoryTrendChart data={trend} />
        </div>
      )}

      {/* Same data, bundled by category instead of by period -- each
          category's own bars fade from oldest (lightest) to newest (full
          color) so trend direction reads at a glance per category. */}
      {period !== 'all' && (
        <div className={`mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5 transition-opacity ${fade}`}>
          <CategoryBundleChart data={trend} />
        </div>
      )}

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
