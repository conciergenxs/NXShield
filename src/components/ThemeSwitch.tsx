import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePref } from '../lib/theme';
import { cx } from './ui';

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** Light, dark or the device's setting, in the account menu. */
export function ThemeSwitch() {
  const [pref, setPref] = useTheme();
  return (
    <div className="theme-row">
      <span className="theme-label">Theme</span>
      <div className="theme-switch" role="radiogroup" aria-label="Theme">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <button key={value} type="button" role="radio" aria-checked={pref === value} aria-label={label} title={label} className={cx('theme-option', pref === value && 'is-on')} onClick={() => setPref(value)}>
            <Icon size={15} aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}
