'use client';

import { useState } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import type { CategoryStat } from '@/lib/api';
import { colorFor } from '@/lib/colors';

export default function CategoryChart({ data }: { data: CategoryStat[] }) {
  const [mode, setMode] = useState<'donut' | 'bar'>('donut');
  const total = data.reduce((sum, d) => sum + d.hours, 0);

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-sm text-zinc-400">Time by category</p>
        <div className="flex overflow-hidden rounded-lg border border-zinc-800">
          <button
            type="button"
            onClick={() => setMode('donut')}
            className={`px-2.5 py-1.5 text-xs ${mode === 'donut' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'}`}
          >
            Donut
          </button>
          <button
            type="button"
            onClick={() => setMode('bar')}
            className={`px-2.5 py-1.5 text-xs ${mode === 'bar' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'}`}
          >
            Bar
          </button>
        </div>
      </div>

      <div className="mb-2.5 flex flex-wrap gap-3.5 text-xs text-zinc-400">
        {data.map((d, i) => (
          <span key={d.name} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorFor(i) }} />
            {d.name} {total ? Math.round((d.hours / total) * 100) : 0}%
          </span>
        ))}
      </div>

      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          {mode === 'donut' ? (
            <PieChart>
              <Pie data={data} dataKey="hours" nameKey="name" innerRadius={70} outerRadius={110} paddingAngle={2}>
                {data.map((d, i) => (
                  <Cell key={d.name} fill={colorFor(i)} stroke="none" />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <BarChart data={data} layout="vertical" margin={{ left: 16 }}>
              <XAxis type="number" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} width={100} />
              <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
                {data.map((d, i) => (
                  <Cell key={d.name} fill={colorFor(i)} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
