const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001';

export type Summary = {
  tracked_hours: number;
  top_category: string | null;
  sessions_today: number;
  pending_review: number;
  period_start: string;
  period_end: string;
  period_label: string;
  has_next: boolean;
};

export type CategoryStat = { name: string; hours: number };
export type DomainStat = { domain: string; hours: number; sessions: number };
export type Candidate = {
  id: string;
  description: string;
  occurrence_count: number;
  total_seconds: number;
  due_for_review: boolean;
};
export type Settings = {
  batch_size: number;
  occurrence_threshold: number;
  duration_threshold_hours: number;
  max_reason_length: number;
  trend_lookback_day: number;
  trend_lookback_week: number;
  trend_lookback_month: number;
  trend_lookback_quarter: number;
  trend_lookback_year: number;
};

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

function periodQs(periodType: string, offset: number) {
  return `?period_type=${periodType}&offset=${offset}`;
}

export function getSummary(periodType: string, offset: number) {
  return getJSON<Summary>(`/summary${periodQs(periodType, offset)}`);
}
export function getCategories(periodType: string, offset: number) {
  return getJSON<CategoryStat[]>(`/categories${periodQs(periodType, offset)}`);
}
export function getDomains(periodType: string, offset: number) {
  return getJSON<DomainStat[]>(`/domains${periodQs(periodType, offset)}`);
}

export type CategoryTrendPeriod = {
  offset: number;
  label: string;
  values: Record<string, number>;
};
export type CategoryTrendData = {
  period_type: string;
  categories: string[];
  periods: CategoryTrendPeriod[];
};

export function getCategoryTrend(periodType: string, offset: number) {
  return getJSON<CategoryTrendData>(`/category-trend${periodQs(periodType, offset)}`);
}
export function getCandidates() {
  return getJSON<Candidate[]>('/candidates');
}
export function getSettings() {
  return getJSON<Settings>('/settings');
}

export async function approveCandidate(id: string, categoryName: string) {
  const res = await fetch(`${API_URL}/candidates/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category_name: categoryName }),
  });
  if (!res.ok) throw new Error('Approve failed');
  return res.json();
}

export async function rejectCandidate(id: string) {
  const res = await fetch(`${API_URL}/candidates/${id}/reject`, { method: 'POST' });
  if (!res.ok) throw new Error('Reject failed');
  return res.json();
}

export async function updateSettings(body: Partial<Settings>) {
  const res = await fetch(`${API_URL}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Settings update failed');
  return res.json();
}

export type HeatmapCell = { domain: string; hour: number; minutes: number };
export type DomainTimelineData = { domains: string[]; data: HeatmapCell[] };

export function getDomainTimeline(periodType: string, offset: number) {
  return getJSON<DomainTimelineData>(`/domain-timeline${periodQs(periodType, offset)}`);
}

export type ClusterMember = {
  id: string;
  description: string;
  occurrence_count: number;
  total_seconds: number;
};

export type Cluster = {
  id: string;
  label: string;
  total_occurrence_count: number;
  total_seconds: number;
  members: ClusterMember[];
};

export function getClusters() {
  return getJSON<Cluster[]>('/clusters');
}

export async function approveCluster(id: string, categoryName: string) {
  const res = await fetch(`${API_URL}/clusters/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category_name: categoryName }),
  });

  if (!res.ok) throw new Error('Approve failed');
  return res.json();
}

export async function rejectCluster(id: string) {
  const res = await fetch(`${API_URL}/clusters/${id}/reject`, {
    method: 'POST',
  });

  if (!res.ok) throw new Error('Reject failed');
  return res.json();
}

// Insights
export type MetricRow = {
  period_start: string;
  metric_type: 'total_usage' | 'domain_usage' | 'category_usage';
  dimension: string | null;
  value_seconds: number;
  rank: number | null;
};

export type InsightsData = {
  period_type: string;
  current_period_start: string;
  previous_period_start: string;
  current: MetricRow[];
  previous: MetricRow[];
};

export function getInsights(periodType: 'day' | 'week' | 'month') {
  return getJSON<InsightsData>(`/insights?period_type=${periodType}`);
}