const PRONUNCIATION = [
  "[data-sound]", ".pron-g", ".pron_g", ".pronunciation", ".phonetics", ".phon",
  ".pron", ".phonetic", ".audio-label", ".sound", ".sr-only", ".visually-hidden"
].join(",");
const SENSE_BLOCK = ".sense, .sense-g, .sn-g, [data-senseid], .idm-g, .phrasal_verb";
const EXAMPLE = ".examples, .example, .x-g, .xg, .x";
const EXACT_HEADWORD = ".headword, .hwd, .hw";
const DIALECT_LABEL = /^(?:(?:BrE|NAmE)\s*)+$/;
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

// The stylesheet and HTML have already gone through dictionary sanitization.
// An attached frame lets the browser apply the same CSS visibility rules as the
// dictionary panel; textContent on a detached document includes hidden labels.
export function extractDictionaryGloss(html: string, css: string, word: string): string {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:100%;height:1px;opacity:0;pointer-events:none";
  document.body.append(frame);
  try {
    const entry = frame.contentDocument;
    const view = frame.contentWindow;
    if (!entry || !view) return "";
    const style = entry.createElement("style");
    style.textContent = css;
    entry.head.append(style);
    entry.body.innerHTML = html;
    if (view.getComputedStyle(entry.body).display === "none") return "";

    const hasDefinitions = [...entry.body.querySelectorAll(".def, .definition, .tran, .trans, .translation, [data-def]")]
      .some((definition) => !definition.closest(EXAMPLE) && Boolean((definition as HTMLElement).innerText?.trim()) &&
        definition.getClientRects().length > 0 && view.getComputedStyle(definition).visibility === "visible");
    // Mark first, then remove: deleting a sibling can change CSS selectors such
    // as :first-child while we are still checking the rest of the entry.
    const omitted: Element[] = [];
    for (const element of entry.body.querySelectorAll("*")) {
      const computed = view.getComputedStyle(element);
      if (computed.display === "none" || computed.opacity === "0" ||
        element.matches(PRONUNCIATION) ||
        (hasDefinitions && element.matches(EXAMPLE)) ||
        (element.matches(EXACT_HEADWORD) && normalize(element.textContent ?? "").toLowerCase() === word.trim().toLowerCase()) ||
        (element.childElementCount === 0 && DIALECT_LABEL.test(normalize(element.textContent ?? "")))) {
        omitted.push(element);
      }
    }
    for (const element of omitted) element.remove();

    for (const element of entry.body.querySelectorAll<HTMLElement>(SENSE_BLOCK)) {
      if (view.getComputedStyle(element).display === "inline") element.style.display = "block";
    }
    // Some MDX files rely on CSS spacing between otherwise adjacent spans.
    for (const label of entry.body.querySelectorAll(".pos, .pos-g, .pos-gs, .gram, .label, .sensenum")) {
      label.before(" ");
      label.after(" ");
    }

    return entry.body.innerText.split(/\r?\n/)
      .map(normalize)
      .filter((line) => line && line.toLowerCase() !== word.trim().toLowerCase() && !DIALECT_LABEL.test(line))
      .join("\n");
  } finally {
    frame.remove();
  }
}
