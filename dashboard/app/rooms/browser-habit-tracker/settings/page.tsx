'use client';

import { useEffect, useState } from 'react';
import ThresholdSlider from '@/components/ThresholdSlider';
import {
  getSettings,
  updateSettings,
  getCandidates,
  getClusters,
  approveCandidate,
  rejectCandidate,
  approveCluster,
  rejectCluster,
  type Candidate,
  type Cluster,
  type Settings,
} from '@/lib/api';

export default function SettingsPage() {
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings().then(setSettingsState);
    getCandidates().then(setCandidates);
    // getClusters may 500 before Agent 2 schema exists -- fail silently
    getClusters().then(setClusters).catch(() => setClusters([]));
  }, []);

  function updateLocal(next: Partial<Settings>) {
    setSettingsState((prev) => (prev ? { ...prev, ...next } : prev));
  }

  function persist(next: Partial<Settings>) {
    setSaving(true);
    updateSettings(next).finally(() => setSaving(false));
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // --- cluster actions ---
  async function handleApproveCluster(cl: Cluster) {
    const name = prompt('Name for the new category:', cl.label);
    if (!name) return;
    await approveCluster(cl.id, name);
    setClusters((prev) => prev.filter((x) => x.id !== cl.id));
  }

  async function handleRejectCluster(cl: Cluster) {
    await rejectCluster(cl.id);
    setClusters((prev) => prev.filter((x) => x.id !== cl.id));
  }

  // --- raw candidate actions (unclustered fallback) ---
  async function handleApprove(c: Candidate) {
    const name = prompt('Name for the new category:', '');
    if (!name) return;
    await approveCandidate(c.id, name);
    setCandidates((prev) => prev.filter((x) => x.id !== c.id));
  }

  async function handleReject(c: Candidate) {
    await rejectCandidate(c.id);
    setCandidates((prev) => prev.filter((x) => x.id !== c.id));
  }

  if (!settings) {
    return <p className="text-sm text-zinc-400">Loading settings…</p>;
  }

  return (
    <div>
      {/* Classification batch */}
      <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <p className="mb-3.5 text-sm text-zinc-400">
          Classification batch{saving ? ' · saving…' : ''}
        </p>
        <ThresholdSlider
          label="Sessions per batch"
          min={5}
          max={100}
          step={5}
          value={settings.batch_size}
          onChange={(v) => updateLocal({ batch_size: v })}
          onCommit={(v) => persist({ batch_size: v })}
          suffix=""
        />
      </div>

      {/* Review thresholds */}
      <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <p className="mb-3.5 text-sm text-zinc-400">Review thresholds</p>
        <ThresholdSlider
          label="Occurrence count"
          min={5}
          max={50}
          step={1}
          value={settings.occurrence_threshold}
          onChange={(v) => updateLocal({ occurrence_threshold: v })}
          onCommit={(v) => persist({ occurrence_threshold: v })}
          suffix=""
        />
        <ThresholdSlider
          label="Total duration"
          min={1}
          max={12}
          step={1}
          value={settings.duration_threshold_hours}
          onChange={(v) => updateLocal({ duration_threshold_hours: v })}
          onCommit={(v) => persist({ duration_threshold_hours: v })}
          suffix="h"
        />
        <ThresholdSlider
          label="Max reason length"
          min={50}
          max={400}
          step={10}
          value={settings.max_reason_length}
          onChange={(v) => updateLocal({ max_reason_length: v })}
          onCommit={(v) => persist({ max_reason_length: v })}
          suffix=" chars"
        />
      </div>

      {/* Clustered review -- only shown after Agent 2 has run */}
      {clusters.length > 0 && (
        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-1.5 text-sm text-zinc-400">
            Clustered review
            <span className="ml-2 rounded bg-indigo-500/10 px-1.5 py-0.5 text-xs text-indigo-400">
              {clusters.length} groups
            </span>
          </p>

          {clusters.map((cl) => (
            <div key={cl.id} className="border-b border-zinc-800 py-3 last:border-0">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Cluster label + summary */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-medium text-zinc-100">{cl.label}</p>
                    <span className="text-xs text-zinc-500">
                      {cl.total_occurrence_count} sessions ·{' '}
                      {Math.round(cl.total_seconds / 60)}m total
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleExpand(cl.id)}
                      className="text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      {expanded.has(cl.id) ? '▲ hide' : '▼'}{' '}
                      {cl.members.length} description
                      {cl.members.length !== 1 ? 's' : ''}
                    </button>
                  </div>

                  {/* Member descriptions -- expandable */}
                  {expanded.has(cl.id) && (
                    <ul className="mt-2 space-y-1 border-l border-zinc-700 pl-3">
                      {cl.members.map((m) => (
                        <li key={m.id} className="text-xs text-zinc-400">
                          &ldquo;{m.description}&rdquo;
                          <span className="ml-1.5 text-zinc-600">
                            {m.occurrence_count} · {Math.round(m.total_seconds / 60)}m
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => handleApproveCluster(cl)}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-800"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRejectCluster(cl)}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-800"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Raw candidates -- shown as-is before Agent 2 runs,
          or as overflow for anything not yet clustered after */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <p className="mb-1.5 text-sm text-zinc-400">
          {clusters.length > 0 ? 'Unclustered candidates' : 'Pending review'}
        </p>

        {candidates.length === 0 && (
          <p className="py-3 text-sm text-zinc-500">Nothing pending.</p>
        )}

        {candidates.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between border-b border-zinc-800 py-2.5 last:border-0"
          >
            <div>
              <p className="text-sm font-medium text-zinc-100">
                {c.description}
                {c.due_for_review && (
                  <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-400">
                    due
                  </span>
                )}
              </p>
              <p className="text-xs text-zinc-500">
                {c.occurrence_count} sessions · {Math.round(c.total_seconds / 60)}m total
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleApprove(c)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-800"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => handleReject(c)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-800"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
