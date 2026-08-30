import { useCallback, useEffect, useState } from 'react';
import type { NavTab } from '../components/Sidebar.js';

const TABS: NavTab[] = [
  'dashboard',
  'templates',
  'apps',
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

function tabFromPath(pathname: string): NavTab {
  const segment = pathname.replace(/^\/+/, '').split('/')[0];
  return (TABS as string[]).includes(segment) ? (segment as NavTab) : DEFAULT_TAB;
}

/**
 * Minimal history-backed routing.
 *
 * The panel previously kept the active section in component state only, so a
 * section could not be linked to, a refresh always returned to the dashboard,
 * and the browser's back button left the app entirely. This keeps the URL in
 * sync without pulling in a router dependency.
 */
export function useRoute(): [NavTab, (tab: NavTab) => void] {
  const [tab, setTab] = useState<NavTab>(() => tabFromPath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setTab(tabFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((next: NavTab) => {
    setTab(next);
    const path = next === DEFAULT_TAB ? '/' : `/${next}`;
    if (window.location.pathname !== path) {
      window.history.pushState({ tab: next }, '', path);
    }
  }, []);

  return [tab, navigate];
}
