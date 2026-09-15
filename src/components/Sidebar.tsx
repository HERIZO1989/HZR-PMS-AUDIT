'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/dashboard', label: 'Tableau de bord' },
  { href: '/reservations', label: 'Reservations' },
  { href: '/guests', label: 'Clients' },
  { href: '/housekeeping', label: 'Housekeeping' },
  { href: '/night-audit', label: 'Night Audit' },
  { href: '/imports', label: 'Imports' },
  { href: '/billing', label: 'Facturation' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="bg-headerbar">
      <div className="flex items-center justify-between px-6 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center bg-brass text-sm font-bold text-white">R</div>
          <div>
            <div className="text-sm font-semibold leading-none text-white">Riviera Suite PMS</div>
          </div>
        </div>
      </div>
      <nav className="flex gap-0.5 overflow-x-auto border-t border-white/10 px-4">
        {ITEMS.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors ${
                active
                  ? 'border-brass-light bg-white text-headerbar font-medium'
                  : 'border-transparent text-white/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
