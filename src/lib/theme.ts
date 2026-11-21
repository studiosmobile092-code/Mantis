import type {AccentColor, ThemeMode} from '../types/mantis';

export const THEME_STORAGE_KEY = 'mantis_theme_v1';
export const ACCENT_STORAGE_KEY = 'mantis_accent_v1';

export const THEME_OPTIONS: Array<{
  id: ThemeMode;
  label: string;
  description: string;
  swatchBg: string;
  swatchSurface: string;
}> = [
  {
    id: 'dark',
    label: 'Dark',
    description: 'Deep slate IDE contrast',
    swatchBg: '#0b1120',
    swatchSurface: '#0f172a',
  },
  {
    id: 'dim',
    label: 'Dim',
    description: 'Low-glare night charcoal',
    swatchBg: '#090d16',
    swatchSurface: '#111623',
  },
  {
    id: 'light',
    label: 'Light',
    description: 'Crisp daylight studio',
    swatchBg: '#f8fafc',
    swatchSurface: '#ffffff',
  },
];

export const ACCENT_OPTIONS: Array<{
  id: AccentColor;
  label: string;
  hex: string;
}> = [
  {id: 'emerald', label: 'Emerald', hex: '#059669'},
  {id: 'blue', label: 'Blue', hex: '#2563eb'},
  {id: 'violet', label: 'Violet', hex: '#7c3aed'},
  {id: 'amber', label: 'Amber', hex: '#b45309'},
  {id: 'rose', label: 'Rose', hex: '#e11d48'},
];

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'dim' || value === 'light' || value === 'dark' ? value : 'dark';
}

export function normalizeAccentColor(value: unknown): AccentColor {
  return value === 'blue' ||
    value === 'violet' ||
    value === 'amber' ||
    value === 'rose' ||
    value === 'emerald'
    ? value
    : 'emerald';
}

export function getStoredTheme(): ThemeMode {
  try {
    return normalizeThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

export function getStoredAccent(): AccentColor {
  try {
    return normalizeAccentColor(window.localStorage.getItem(ACCENT_STORAGE_KEY));
  } catch {
    return 'emerald';
  }
}

export function applyThemeAndAccent(theme: ThemeMode, accent: AccentColor): void {
  const safeTheme = normalizeThemeMode(theme);
  const safeAccent = normalizeAccentColor(accent);

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, safeTheme);
    window.localStorage.setItem(ACCENT_STORAGE_KEY, safeAccent);
  } catch {
    // Ignore storage write restriction
  }

  const root = document.documentElement;
  root.setAttribute('data-theme', safeTheme);
  root.setAttribute('data-accent', safeAccent);
  if (safeTheme === 'light') {
    root.classList.remove('dark');
  } else {
    root.classList.add('dark');
  }
}

export function getNextThemeMode(current: ThemeMode): ThemeMode {
  if (current === 'dark') return 'dim';
  if (current === 'dim') return 'light';
  return 'dark';
}
