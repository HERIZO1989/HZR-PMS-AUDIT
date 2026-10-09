'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoutButton } from '@/components/LogoutButton';

const ITEMS = [
  { href: '/dashboard', label: 'Tableau de bord' },
  { href: '/reservations', label: 'Réservations' },
  { href: '/guests', label: 'Clients' },
  { href: '/housekeeping', label: 'Housekeeping' },
  { href: '/night-audit', label: 'Night Audit' },
  { href: '/imports', label: 'Imports' },
  { href: '/billing', label: 'Facturation' },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Barre de navigation unique : marque, sections, utilisateur. Sur mobile les sections passent sur une seconde ligne defilante. */
export function Sidebar({ displayName, showDemo = false }: { displayName: string; showDemo?: boolean }) {
  const pathname = usePathname();
  const items = showDemo ? [...ITEMS, { href: '/demo', label: 'Démo' }] : ITEMS;

  return (
    <header className="bg-navy text-white">
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-8 px-6">
        <Link href="/dashboard" className="flex items-center gap-3 py-3.5">
          <span className="flex h-8 w-8 items-center justify-center rounded border border-brass bg-navy-deep font-display text-base text-brass-light">
            P
          </span>
          <span className="font-display text-lg leading-none tracking-tight">PMS Audit</span>
        </Link>

        <nav
          aria-label="Sections"
          className="order-3 -mx-2 flex w-full overflow-x-auto border-t border-navy-line md:order-none md:mx-0 md:w-auto md:flex-1 md:border-t-0"
        >
          {items.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`relative shrink-0 whitespace-nowrap px-3 py-4 text-sm transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full ${
                  active
                    ? 'font-medium text-white after:bg-brass'
                    : 'text-white/70 after:bg-transparent hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3 py-2.5 text-sm">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-brass-tint text-xs font-semibold text-navy"
          >
            {initials(displayName)}
          </span>
          <span className="hidden text-white/90 sm:inline">{displayName}</span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
