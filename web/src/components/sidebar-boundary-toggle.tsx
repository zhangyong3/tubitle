import { ChevronLeft, ChevronRight } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { useSidebar } from '@/components/ui/sidebar';

export function SidebarBoundaryToggle({ variant, collapsible, mobileDrawer = false }: { mobileDrawer?: boolean; variant: 'sidebar' | 'floating' | 'inset'; collapsible: 'offcanvas' | 'icon' }) {
  const { open, isMobile, openMobile, toggleSidebar } = useSidebar();
  // An open mobile sheet makes outside controls inert. Render its close
  // arrow inside the drawer portal, while keeping the desktop control outside.
  if (mobileDrawer ? !(isMobile && openMobile) : isMobile && openMobile) return null;
  const expanded = isMobile ? openMobile : open;
  const hidden = !expanded && (isMobile || collapsible === 'offcanvas');
  const edge = isMobile
    ? (openMobile ? 'min(18rem, calc(100vw - 24px))' : '0px')
    : open ? 'var(--sidebar-width)' : collapsible === 'icon'
      ? variant === 'sidebar' ? 'var(--sidebar-width-icon)' : 'calc(var(--sidebar-width-icon) + 1rem)'
      : '0px';
  const label = expanded ? m['common.sidebar.collapse']() : m['common.sidebar.expand']();
  return <button type="button" className="app-sidebar-boundary-toggle" data-flush={hidden || undefined} style={{ left: `max(0px, calc(${edge} - 12px))` }} onClick={toggleSidebar} aria-expanded={expanded} aria-label={label} title={label}>
    {expanded ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
  </button>;
}
