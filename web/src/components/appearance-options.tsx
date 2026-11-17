import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface AppearanceOption {
  id: string;
  label: string;
  /** Color dot shown before the label (themes). */
  swatch?: string;
  /** Render the label in this font-family (fonts). */
  fontFamily?: string;
}

/** A row of selectable chips for an appearance setting. */
export function AppearanceOptions({
  options,
  value,
  onChange,
}: {
  options: AppearanceOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const selected = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.id)}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
              'focus-visible:ring-ring/50 outline-none focus-visible:ring-3',
              selected
                ? 'border-primary bg-accent text-accent-foreground font-medium'
                : 'hover:bg-muted/60'
            )}
          >
            {opt.swatch && <ThemeDot color={opt.swatch} />}
            <span style={opt.fontFamily ? { fontFamily: opt.fontFamily } : {}}>
              {opt.label}
            </span>
            {selected && <CheckIcon className="size-3.5" />}
          </button>
        );
      })}
    </div>
  );
}

export function ThemeDot({
  color,
  className,
}: {
  color: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-4 shrink-0 rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/20',
        className
      )}
      style={{ background: color }}
    />
  );
}
