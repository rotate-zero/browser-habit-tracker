'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const rooms = [{ href: '/rooms/browser-habit-tracker', label: 'Browser habit tracker' }];

export default function RoomTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-3 flex flex-wrap gap-2">
      {rooms.map((room) => (
        <Link
          key={room.href}
          href={room.href}
          className={`rounded-lg border px-4 py-2 text-sm font-medium ${
            pathname.startsWith(room.href)
              ? 'border-indigo-500/50 bg-zinc-900 text-zinc-100'
              : 'border-zinc-800 bg-zinc-900/50 text-zinc-400'
          }`}
        >
          {room.label}
        </Link>
      ))}
      <span className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm text-zinc-600">
        Agent 2 · coming soon
      </span>
      <span className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm text-zinc-600">+</span>
    </nav>
  );
}
