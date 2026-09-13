type KeyboardLikeEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

function physicalKey(event: KeyboardLikeEvent): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown)$/.test(event.code)) return event.code;
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

export function shortcutFromEvent(event: KeyboardLikeEvent): string {
  const modifiers = [
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Meta"
  ].filter(Boolean);
  return [...modifiers, physicalKey(event)].join("+");
}

export function shortcutsMatch(actual: string, configured: string): boolean {
  return actual.toLowerCase() === configured.replace(/\s+/g, "").toLowerCase();
}
