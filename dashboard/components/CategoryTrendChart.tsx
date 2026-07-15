'use client';

import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { CategoryTrendData } from '@/lib/api';
import { colorFor } from '@/lib/colors';

export default function CategoryTrendChart({ data }: { data: CategoryTrendData | null }) {
  const [mode, setMode] = useState<'grouped' | 'stacked'>('grouped');

  const categories = data?.categories ?? [];
  const periods = data?.periods ?? [];

  // Reshape [{offset, label, values: {cat: hours}}] into recharts' flat
  // row-per-period shape: [{label, "Cat A": 1.2, "Cat B": 0.4, ...}]
  const chartData = periods.map((p) => {
    const row: Record<string, string | number> = { label: p.label };
    for (const cat of categories) {
      row[cat] = p.values[cat] ?? 0;
    }
    return row;
  });

  const isEmpty = categories.length === 0 || periods.length === 0;

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-sm text-zinc-400">Top categories over time</p>
        <div className="flex overflow-hidden rounded-lg border border-zinc-800">
          <button
            type="button"
            onClick={() => setMode('grouped')}
            className={`px-2.5 py-1.5 text-xs ${mode === 'grouped' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'}`}
          >
            Grouped
          </button>
          <button
            type="button"
            onClick={() => setMode('stacked')}
            className={`px-2.5 py-1.5 text-xs ${mode === 'stacked' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'}`}
          >
            Stacked
          </button>
        </div>
      </div>

      {isEmpty ? (
        <p className="py-8 text-center text-sm text-zinc-500">No data yet for this timeframe.</p>
      ) : (
        <>
          <div className="mb-2.5 flex flex-wrap gap-3.5 text-xs text-zinc-400">
            {categories.map((cat, i) => (
              <span key={cat} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorFor(i) }} />
                {cat}
              </span>
            ))}
          </div>

          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#a1a1aa', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#a1a1aa', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
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
                  formatter={(value: number) => [`${value}h`, '']}
                />
                {categories.map((cat, i) => (
                  <Bar
                    key={cat}
                    dataKey={cat}
                    stackId={mode === 'stacked' ? 'trend' : undefined}
                    fill={colorFor(i)}
                    radius={mode === 'stacked' ? undefined : [3, 3, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
