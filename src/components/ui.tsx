import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

type Variant = 'primary' | 'soft' | 'white' | 'ghost' | 'danger';
type Size = 'md' | 'lg' | 'xl';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-mint-500 text-white shadow-md shadow-mint-500/25 hover:bg-mint-600',
  soft: 'bg-mint-50 text-mint-700 hover:bg-mint-100',
  white: 'bg-white text-ink shadow-sm hover:shadow-md',
  ghost: 'bg-transparent text-ink-soft hover:bg-slate-100',
  danger: 'bg-rose-50 text-rose-600 hover:bg-rose-100',
};
const SIZE: Record<Size, string> = {
  md: 'h-12 px-5 text-base',
  lg: 'h-14 px-6 text-lg',
  xl: 'h-20 px-8 text-2xl',
};

export function Button({
  variant = 'primary',
  size = 'lg',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={`pressable inline-flex items-center justify-center gap-2 rounded-2xl font-bold ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-6 shadow-sm ${className}`}>{children}</div>;
}

export function ScreenHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <header className="flex items-center gap-3 px-6 pt-5 pb-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="처음으로"
        className="pressable flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm"
      >
        <ArrowLeft className="h-6 w-6" />
      </button>
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </header>
  );
}

/** 여러 개 중 하나 고르기 */
export function Choice<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`pressable h-12 min-w-16 rounded-2xl px-4 text-base font-bold ${
              on ? 'bg-mint-500 text-white shadow-md shadow-mint-500/25' : 'bg-slate-100 text-ink-soft hover:bg-slate-200'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="pressable flex w-full items-center gap-4 rounded-2xl bg-slate-50 px-4 py-3 text-left hover:bg-slate-100"
    >
      <span className="flex-1">
        <span className="block text-base font-bold">{label}</span>
        {hint && <span className="block text-sm text-ink-soft">{hint}</span>}
      </span>
      <span className={`relative h-8 w-14 shrink-0 rounded-full transition-all duration-200 ${checked ? 'bg-mint-500' : 'bg-slate-300'}`}>
        <span
          className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-all duration-200 ${checked ? 'left-7' : 'left-1'}`}
        />
      </span>
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-base font-bold">{label}</span>
        {hint && <span className="text-sm text-ink-soft">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ icon, title, desc, action }: { icon: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-mint-50 text-mint-500">{icon}</div>
      <p className="text-lg font-bold">{title}</p>
      {desc && <p className="max-w-sm text-ink-soft">{desc}</p>}
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, tone = 'mint' }: { label: string; value: string; sub?: string; tone?: 'mint' | 'rose' | 'slate' }) {
  const color = tone === 'mint' ? 'text-mint-600' : tone === 'rose' ? 'text-rose-500' : 'text-ink';
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="text-base font-bold text-ink-soft">{label}</div>
      <div className={`tabular mt-1 text-5xl font-black tracking-tight ${color}`}>{value}</div>
      {sub && <div className="mt-2 text-sm text-ink-soft">{sub}</div>}
    </div>
  );
}
