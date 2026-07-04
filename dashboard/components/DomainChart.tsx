'use client';

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import type { DomainStat } from '@/lib/api';

export default function DomainChart({
  data,
  metric,
  color,
}: {
  data: DomainStat[];
  metric: 'hours' | 'sessions';
  color: string;
}) {
  const sorted = [...data].sort((a, b) => b[metric] - a[metric]);
  // 36px per bar so labels don't crowd each other, minimum 280px
  const chartHeight = Math.max(280, sorted.length * 36);

  return (
    <div style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={sorted}
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
            dataKey="domain"
            tick={{ fill: '#a1a1aa', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={145}
          />
          <Tooltip
            contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
            labelStyle={{ color: '#f4f4f5' }}
            itemStyle={{ color: '#a1a1aa' }}
          />
          <Bar dataKey={metric} radius={[0, 4, 4, 0]} fill={color} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
