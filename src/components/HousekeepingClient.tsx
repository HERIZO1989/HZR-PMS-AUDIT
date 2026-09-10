'use client';

import { useEffect, useState } from 'react';

interface Task {
  id: string;
  task_type: string;
  status: string;
  priority: string;
  scheduled_for: string | null;
  notes: string | null;
  rooms: { room_number: string; floor: string } | null;
  staff_users: { display_name: string } | null;
}

const COLUMNS: { key: string; label: string }[] = [
  { key: 'pending', label: 'À faire' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'completed', label: 'Terminé' },
  { key: 'verified', label: 'Vérifié' },
];

const TASK_LABELS: Record<string, string> = {
  cleaning: 'Nettoyage',
  turnover: 'Remise en état',
  deep_clean: 'Nettoyage approfondi',
  maintenance: 'Maintenance',
  inspection: 'Inspection',
};

export function HousekeepingClient({ hotelId }: { hotelId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/housekeeping?hotelId=${hotelId}`)
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks ?? []))
      .finally(() => setLoading(false));
  }, [hotelId]);

  async function advance(task: Task) {
    const next: Record<string, string> = { pending: 'in_progress', in_progress: 'completed', completed: 'verified' };
    const nextStatus = next[task.status];
    if (!nextStatus) return;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    await fetch('/api/housekeeping', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, status: nextStatus }),
    });
  }

  if (loading) return <div className="text-ink-400">Chargement…</div>;

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl text-parchment">Housekeeping</h1>
        <p className="mt-1 text-sm text-ink-400">{tasks.length} tâches</p>
      </header>

      <div className="grid grid-cols-4 gap-6">
        {COLUMNS.map((col) => (
          <div key={col.key}>
            <div className="mb-3 flex items-center justify-between border-b border-ink-700 pb-2">
              <span className="text-sm text-ink-400">{col.label}</span>
              <span className="text-xs text-ink-400">{tasks.filter((t) => t.status === col.key).length}</span>
            </div>
            <div className="flex flex-col gap-3">
              {tasks
                .filter((t) => t.status === col.key)
                .map((t) => (
                  <button
                    key={t.id}
                    onClick={() => advance(t)}
                    disabled={col.key === 'verified'}
                    className={`border-l-2 bg-ink-800 px-3 py-3 text-left ${
                      t.priority === 'urgent' || t.priority === 'high' ? 'border-l-wine' : 'border-l-ink-600'
                    }`}
                  >
                    <div className="text-sm text-parchment">Chambre {t.rooms?.room_number ?? '—'}</div>
                    <div className="mt-0.5 text-xs text-ink-400">{TASK_LABELS[t.task_type] ?? t.task_type}</div>
                    {t.staff_users?.display_name && (
                      <div className="mt-1 text-xs text-brass-light">{t.staff_users.display_name}</div>
                    )}
                    {t.notes && <div className="mt-1 text-xs italic text-ink-400">{t.notes}</div>}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
