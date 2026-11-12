/** Server component: the active tab is decided client-side by usePathname in TabNav so this
 *  layout itself needs no request-time data. */
import { MessageCircle } from 'lucide-react';
import { TabNav } from './TabNav';

const TABS = [
  { href: '/whatsapp', label: 'Overview' },
  { href: '/whatsapp/inbox', label: 'Inbox' },
  { href: '/whatsapp/campaigns', label: 'Campaigns' },
  { href: '/whatsapp/templates', label: 'Templates' },
  { href: '/whatsapp/accounts', label: 'Accounts' },
  { href: '/whatsapp/reports', label: 'Reports' },
];

export default function WhatsAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2.5 text-[21px] font-bold tracking-tight text-ink sm:text-[24px]">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl sm:h-9 sm:w-9 bg-gradient-to-br from-[#25d366] to-[#128c7e] text-white shadow-sm">
            <MessageCircle size={19} aria-hidden />
          </span>
          WhatsApp
        </h1>
        <TabNav tabs={TABS} />
      </div>
      {children}
    </div>
  );
}
