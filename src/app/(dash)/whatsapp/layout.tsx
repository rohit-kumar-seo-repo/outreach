const TABS = [
  { href: '/whatsapp', label: 'Overview' },
  { href: '/whatsapp/campaigns', label: 'Campaigns' },
  { href: '/whatsapp/inbox', label: 'Inbox' },
  { href: '/whatsapp/templates', label: 'Templates' },
  { href: '/whatsapp/accounts', label: 'Accounts' },
  { href: '/whatsapp/reports', label: 'Reports' },
];

/** Server component: the active tab is decided client-side by usePathname in TabNav so this
 *  layout itself needs no request-time data. */
import { TabNav } from './TabNav';

export default function WhatsAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-5 border-b border-line">
        <TabNav tabs={TABS} />
      </div>
      {children}
    </div>
  );
}
