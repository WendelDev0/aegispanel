import { useCallback, useEffect, useState } from 'react';
import type { NavTab } from '../components/Sidebar.js';

const TABS: NavTab[] = [
  'dashboard',
  'templates',
  'apps',
  'analytics',
  'nodes',
  'databases',
  'querystudio',
  'filemanager',
  'cron',
  'containers',
  'domains',
  'firewall',
  'backups',
  'terminal',
  'monitor',
  'settings',
  'help',
];

const DEFAULT_TAB: NavTab = 'dashboard';

function parsePath(pathname: string): { tab: NavTab; param: string | null } {
  const [segment, param] = pathname.replace(/^\/+/, '').split('/');
  return {
    tab: (TABS as string[]).includes(segment) ? (segment as NavTab) : DEFAULT_TAB,
    param: param ? decodeURIComponent(param) : null,
  };
}

/**
 * Minimal history-backed routing.
 *
 * The panel previously kept the active section in component state only, so a
 * section could not be linked to, a refresh always returned to the dashboard,
 * and the browser's back button left the app entirely. This keeps the URL in
 * sync without pulling in a router dependency.
 */
export function useRoute(): [NavTab, (tab: NavTab, param?: string) => void, string | null] {
  const [route, setRoute] = useState(() => parsePath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((next: NavTab, param?: string) => {
    setRoute({ tab: next, param: param ?? null });
    const base = next === DEFAULT_TAB ? '/' : `/${next}`;
    const path = param ? `${base}/${encodeURIComponent(param)}` : base;
    if (window.location.pathname !== path) {
      window.history.pushState({ tab: next, param }, '', path);
    }
  }, []);

  return [route.tab, navigate, route.param];
}
