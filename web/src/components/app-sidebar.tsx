'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';

import { SidebarBoundaryToggle } from '@/components/sidebar-boundary-toggle';
import { Link, usePathname } from '@/core/i18n/navigation';
import { localizeHref } from '@/paraglide/runtime.js';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';

export interface NavSubItem {
  href: string;
  label: string;
  newTab?: boolean;
}

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group?: string;
  newTab?: boolean;
  /** Sub-items render as a collapsible group under this item. */
  items?: NavSubItem[];
}

export function AppSidebar({
  brand,
  logo,
  brandHref = '/',
  navItems,
  footerNavItems,
  footer,
  variant = 'inset',
  collapsible = 'offcanvas',
}: {
  brand: React.ReactNode;
  /** Logo image shown before the brand (alone on the icon rail). */
  logo?: string;
  brandHref?: string;
  navItems: NavItem[];
  footerNavItems?: NavItem[];
  footer?: React.ReactNode;
  variant?: 'sidebar' | 'floating' | 'inset';
  /** offcanvas hides the sidebar on toggle; icon shrinks it to an icon rail. */
  collapsible?: 'offcanvas' | 'icon';
}) {
  const pathname = usePathname();
  // A misconfigured logo URL falls back to the text brand, not a broken image.
  const [logoFailed, setLogoFailed] = useState(false);
  const showLogo = !!logo && !logoFailed;
  // The SSR'd image may have failed before hydration, when onError can't fire.
  const logoRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = logoRef.current;
    if (img?.complete && img.naturalWidth === 0) setLogoFailed(true);
  }, [logo]);

  // Group nav items by their (static) group label.
  const groups: { label?: string; items: NavItem[] }[] = [];
  let currentGroup: string | undefined = '__initial__';
  for (const item of navItems) {
    if (item.group !== currentGroup) {
      groups.push({ label: item.group, items: [item] });
      currentGroup = item.group;
    } else {
      groups[groups.length - 1].items.push(item);
    }
  }

  // The first nav item (dashboard root, e.g. /admin) matches exactly; everything
  // else matches by path prefix so sub-routes light up their entry.
  const isActiveHref = (href: string) =>
    href === navItems[0]?.href
      ? pathname === href
      : pathname === href || pathname.startsWith(href + '/');

  // Hrefs of parent items whose sub-items contain the current route.
  const activeParents = () => {
    const set = new Set<string>();
    for (const item of navItems) {
      if (item.items?.some((sub) => isActiveHref(sub.href))) set.add(item.href);
    }
    return set;
  };

  // Collapsible parents open by default: only the first one (plus whichever
  // holds the current route, added below).
  const defaultParents = () => {
    const first = navItems.find((i) => i.items?.length);
    const set = first ? new Set([first.href]) : new Set<string>();
    for (const href of activeParents()) set.add(href);
    return set;
  };

  // Which collapsible parents are open. Seeded with the defaults (SSR-safe),
  // then replaced by the persisted set after mount if the user has one.
  const storageKey = `sidebar-open:${brandHref}`;
  const [openItems, setOpenItems] = useState<Set<string>>(defaultParents);

  useEffect(() => {
    let saved: string[] | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    } catch {}
    setOpenItems(() => {
      const next = saved ? new Set(saved) : defaultParents();
      for (const href of activeParents()) next.add(href);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Keep the active parent open as the route changes, without touching others.
  useEffect(() => {
    setOpenItems((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const href of activeParents()) {
        if (!next.has(href)) {
          next.add(href);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function toggleItem(href: string) {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  return (
    <Sidebar variant={variant} collapsible={collapsible}>
      <SidebarBoundaryToggle variant={variant} collapsible={collapsible} mobileDrawer />
      {/* Keep a compact brand row above navigation. */}
      <SidebarHeader className="h-14 justify-center py-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <Link
              href={brandHref}
              className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
            >
              {showLogo && (
                <img
                  ref={logoRef}
                  src={logo}
                  alt=""
                  onError={() => setLogoFailed(true)}
                  className="size-7 shrink-0 rounded-lg object-contain"
                />
              )}
              <span className="flex-1 truncate font-serif text-lg leading-none italic group-data-[collapsible=icon]:hidden">
                {brand}
              </span>
              {/* Icon rail without a logo: the brand's first letter. */}
              {!showLogo && typeof brand === 'string' && (
                <span className="hidden w-full text-center font-serif text-lg leading-none italic group-data-[collapsible=icon]:block">
                  {brand.charAt(0)}
                </span>
              )}
            </Link>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group, gi) => (
          <SidebarGroup key={gi}>
            {group.label && (
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            )}
            <SidebarGroupContent className="flex flex-col gap-2">
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;

                  // Collapsible parent with sub-items.
                  if (item.items?.length) {
                    const open = openItems.has(item.href);
                    const childActive = item.items.some((sub) =>
                      isActiveHref(sub.href)
                    );
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          tooltip={item.label}
                          isActive={childActive && !open}
                          aria-expanded={open}
                          onClick={() => toggleItem(item.href)}
                        >
                          <Icon />
                          <span>{item.label}</span>
                          <ChevronRight
                            className={`text-sidebar-foreground/70 ml-auto size-4 shrink-0 transition-transform ${
                              open ? 'rotate-90' : ''
                            }`}
                          />
                        </SidebarMenuButton>
                        {open && (
                          <SidebarMenuSub>
                            {item.items.map((sub) => (
                              <SidebarMenuSubItem key={sub.href}>
                                <SidebarMenuSubButton
                                  render={<Link href={sub.href} />}
                                  isActive={isActiveHref(sub.href)}
                                >
                                  <span>{sub.label}</span>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        )}
                      </SidebarMenuItem>
                    );
                  }

                  // Plain link.
                  return (
                    <SidebarMenuItem key={item.href}>
                      <Link href={item.href}>
                        <SidebarMenuButton
                          tooltip={item.label}
                          isActive={isActiveHref(item.href)}
                        >
                          <Icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </Link>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        {footerNavItems && footerNavItems.length > 0 && (
          <SidebarMenu>
            {footerNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.newTab
                ? false
                : item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href);
              const button = (
                <SidebarMenuButton tooltip={item.label} isActive={isActive}>
                  <Icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              );
              return (
                <SidebarMenuItem key={item.href}>
                  {item.newTab ? (
                    <a
                      href={localizeHref(item.href)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {button}
                    </a>
                  ) : (
                    <Link href={item.href}>{button}</Link>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        )}
        {footer}
      </SidebarFooter>
    </Sidebar>
  );
}
