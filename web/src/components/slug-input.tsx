/** Same normalization as the server; validation happens there. */
export function tidySlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** URL slug field with a fixed path prefix (e.g. `/blog/`), tidied on blur. */
export function SlugInput({
  id,
  prefix,
  value,
  placeholder,
  maxLength = 80,
  onChange,
}: {
  id?: string;
  prefix: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="border-input focus-within:ring-ring/50 flex items-center overflow-hidden rounded-lg border focus-within:ring-3">
      <span className="text-muted-foreground bg-muted border-input border-r px-2.5 py-1 text-sm">
        {prefix}
      </span>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onChange(tidySlug(value))}
        className="placeholder:text-muted-foreground h-8 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none"
      />
    </div>
  );
}
