'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/dashboard', label: 'Tableau de bord' },
  { href: '/reservations', label: 'Réservations' },
  { href: '/guests', label: 'Clients' },
  { href: '/housekeeping', label: 'Housekeeping' },
  { href: '/night-audit', label: 'Night Audit' },
  { href: '/imports', label: 'Imports' },
  { href: '/billing', label: 'Facturation' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 border-r border-ink-700 bg-ink-900 px-6 py-8">
      <div className="mb-10">
        <div className="font-display text-xl text-parchment">Riviera</div>
        <div className="text-xs text-ink-400 tracking-normal">Suite PMS</div>
      </div>
      <nav className="flex flex-col gap-1">
        {ITEMS.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`border-l-2 px-3 py-2 text-sm transition-colors ${
                active
                  ? 'border-brass text-parchment'
                  : 'border-transparent text-ink-400 hover:text-parchment'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
