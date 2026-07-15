'use client';

import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { CategoryTrendData } from '@/lib/api';
import { colorFor } from '@/lib/colors';

export default function CategoryBundleChart({ data }: { data: CategoryTrendData | null }) {
  const categories = data?.categories ?? [];
  const periods = data?.periods ?? []; // oldest -> newest, per /category-trend

  const isEmpty = categories.length === 0 || periods.length === 0;

  // One row per category; one dataKey per period ("p0".."pN"), so each
  // category's periods render as a grouped cluster of bars in that row.
  const chartData = categories.map((cat) => {
    const row: Record<string, string | number> = { category: cat };
    periods.forEach((p, i) => {
      row[`p${i}`] = p.values[cat] ?? 0;
    });
    return row;
  });

  // Rendered newest-first so the newest period's bar appears on top within
  // each category's bundle -- dataKey still points at the original index
  // so it lines up with how chartData was built above.
  const periodsNewestFirst = periods.map((p, i) => ({ p, i })).slice().reverse();

  const rowHeight = Math.max(50, periods.length * 16 + 24);
  const chartHeight = Math.max(280, categories.length * rowHeight);

  return (
    <div>
      <p className="mb-2.5 text-sm text-zinc-400">Category comparison, newest on top.</p>

      {isEmpty ? (
        <p className="py-8 text-center text-sm text-zinc-500">No data yet for this timeframe.</p>
      ) : (
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
            >
              <XAxis
                type="number"
                tick={{ fill: '#a1a1aa', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="category"
                tick={{ fill: '#a1a1aa', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={150}
              />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                contentStyle={{
                  background: '#18181b',
                  border: '1px solid #27272a',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: '#e4e4e7' }}
                formatter={(value: number, name: string) => [`${value}h`, name]}
              />
              {periodsNewestFirst.map(({ p, i }) => (
                <Bar key={p.offset} dataKey={`p${i}`} name={p.label} radius={[0, 3, 3, 0]}>
                  {categories.map((cat, catIdx) => (
                    <Cell key={cat} fill={colorFor(catIdx)} />
                  ))}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
