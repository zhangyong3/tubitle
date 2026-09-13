const BLOCKED_TAGS = new Set([
  "AUDIO", "BASE", "BUTTON", "CANVAS", "EMBED", "FORM", "IFRAME", "IMG", "INPUT",
  "LINK", "MARQUEE", "MATH", "META", "NOSCRIPT", "OBJECT", "OPTION", "PORTAL", "SCRIPT",
  "SELECT", "STYLE", "SVG", "TEMPLATE", "TEXTAREA", "VIDEO"
]);

export function sanitizeDictionaryHtml(value: string): string {
  const source = new DOMParser().parseFromString(`<div>${value}</div>`, "text/html").body.firstElementChild;
  const output = document.createElement("div");
  if (!source) return "";

  const copyNode = (node: Node, parent: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ""));
      return;
    }
    if (!(node instanceof Element)) return;
    if (BLOCKED_TAGS.has(node.tagName)) return;
    const clean = node.cloneNode(false) as Element;
    for (const attribute of [...clean.attributes]) clean.removeAttribute(attribute.name);
    copySafeAttributes(node, clean);
    if (node.tagName === "A") {
      const href = node.getAttribute("href") ?? "";
      if (href.toLowerCase().startsWith("entry://")) {
        clean.setAttribute("href", "#");
        clean.setAttribute("data-entry", safeDecodeURIComponent(href.slice(8)));
      } else if (href.startsWith("#")) {
        clean.setAttribute("href", href);
      } else if (/^(?:sound|audio):\/\//i.test(href)) {
        clean.setAttribute("href", href);
        clean.setAttribute("data-sound", safeDecodeURIComponent(href.replace(/^(?:sound|audio):\/\//i, "")));
      } else if (/\.(?:mp3|wav|ogg|oga|opus|spx|m4a|aac)(?:[?#]|$)/i.test(href)) {
        clean.setAttribute("href", href);
        clean.setAttribute("data-sound", safeDecodeURIComponent(href.split(/[?#]/, 1)[0] ?? href));
      }
    }
    if (!clean.hasAttribute("data-sound")) {
      const handler = node.getAttribute("onclick") ?? "";
      const legacySound = /(?:playSound|playAudio|pronounce)\s*\(\s*['"]([^'"]+)['"]/i.exec(handler)?.[1];
      if (legacySound) clean.setAttribute("data-sound", safeDecodeURIComponent(legacySound.replace(/^(?:sound|audio):\/\//i, "")));
    }
    for (const child of node.childNodes) copyNode(child, clean);
    parent.appendChild(clean);
  };
  for (const child of source.childNodes) copyNode(child, output);
  return output.innerHTML;
}

function copySafeAttributes(source: Element, target: Element): void {
  const blockedNames = new Set([
    "action", "autofocus", "contenteditable", "formaction", "href", "http-equiv", "poster", "src",
    "srcdoc", "srcset", "tabindex", "xlink:href"
  ]);
  for (const attribute of source.attributes) {
    const name = attribute.name.toLowerCase();
    if (name === "style") {
      const style = sanitizeDictionaryCss(attribute.value, 8_000);
      if (style) target.setAttribute("style", style);
    } else if (!name.startsWith("on") && !blockedNames.has(name) && name !== "data-entry") {
      try { target.setAttribute(attribute.name, attribute.value); } catch { /* ignore malformed legacy attributes */ }
    }
  }
}

export function sanitizeDictionaryCss(value: string, maximumLength = 400_000): string {
  return value
    .slice(0, maximumLength)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\[\da-f]{1,6}\s?/gi, "")
    .replace(/@(?:import|charset|namespace)\b[^;]*;?/gi, "")
    .replace(/url\s*\((?:[^)(]|\([^)]*\))*\)/gi, "none")
    .replace(/expression\s*\((?:[^)(]|\([^)]*\))*\)/gi, "")
    .replace(/(^|[;{])\s*(?:behavior|-moz-binding)\s*:[^;}]*;?/gi, "$1")
    .replace(/position\s*:\s*(?:fixed|sticky)\b/gi, "position: static")
    .trim();
}

export function extractDictionaryStyles(value: string): { embeddedCss: string; links: string[] } {
  const documentValue = new DOMParser().parseFromString(`<div id="dictionary-source">${value}</div>`, "text/html");
  const source = documentValue.getElementById("dictionary-source");
  if (!source) return { embeddedCss: "", links: [] };
  const embeddedCss = [...source.querySelectorAll("style")]
    .map((style) => style.textContent ?? "")
    .join("\n");
  const links = [...source.querySelectorAll("link[rel~='stylesheet'][href]")]
    .map((link) => link.getAttribute("href")?.trim() ?? "")
    .filter(Boolean);
  return { embeddedCss: sanitizeDictionaryCss(embeddedCss), links: [...new Set(links)].slice(0, 6) };
}

function safeDecodeURIComponent(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
