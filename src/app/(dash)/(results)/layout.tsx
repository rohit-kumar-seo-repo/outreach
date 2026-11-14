/** Results: what the outreach produced. One section, four views (the active tab is decided client-side). */
import { BarChart3 } from 'lucide-react';
import { TabNav } from '@/components/TabNav';

const TABS = [
  { href: '/campaigns', label: 'Sources' },
  { href: '/overview', label: 'Performance' },
  { href: '/sending', label: 'Sending' },
  { href: '/reports', label: 'Exports' },
];

export default function ResultsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2.5 text-[21px] font-bold tracking-tight text-ink sm:text-[24px]">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-sm sm:h-9 sm:w-9">
            <BarChart3 size={19} aria-hidden />
          </span>
          Results
        </h1>
        <TabNav tabs={TABS} label="Results sections" />
      </div>
      {children}
    </div>
  );
}
