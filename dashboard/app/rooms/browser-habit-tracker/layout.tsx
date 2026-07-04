'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function BrowserHabitTrackerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) =>
    pathname === href || pathname.startsWith(href + '/') ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-400';

  return (
    <div className="border-t border-zinc-800 pt-6">
      <nav className="mb-6 flex gap-2">
        <Link
          href="/rooms/browser-habit-tracker"
          className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${
            pathname === '/rooms/browser-habit-tracker' ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-400'
          }`}
        >
          Dashboard
        </Link>
        <Link
          href="/rooms/browser-habit-tracker/insights"
          className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${active('/rooms/browser-habit-tracker/insights')}`}
        >
          Insights
        </Link>
        <Link
          href="/rooms/browser-habit-tracker/settings"
          className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${active('/rooms/browser-habit-tracker/settings')}`}
        >
          Settings
        </Link>
      </nav>
      {children}
    </div>
  );
}
