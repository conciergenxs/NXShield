import { useCallback, useEffect, useState } from 'react';

/* Light or dark, or whatever the device uses. The choice is a per-browser
   convenience kept in localStorage; the page works without it. */

export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'nxshield.theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readThemePref);
  useEffect(() => {
    applyTheme(pref);
    if (pref !== 'system') return;
    const m = media();
    const onChange = () => applyTheme('system');
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, [pref]);
  const set = useCallback((p: ThemePref) => {
    setPref(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      // Remembering is a convenience; blocked storage just forgets it.
    }
  }, []);
  return [pref, set];
}
