import { describe, expect, it } from "vitest";
import { sanitizeDictionaryCss } from "./dictionary-sanitize";

describe("dictionary CSS sanitizing", () => {
  it("keeps ordinary dictionary formatting", () => {
    const css = sanitizeDictionaryCss("html, body { background: #171717; } .sense { color: #246; font-weight: 700; margin: 4px; }");
    expect(css).toContain("html, body { background: #171717; }");
    expect(css).toContain(".sense { color: #246; font-weight: 700; margin: 4px; }");
  });

  it("blocks network loads and page-covering positioning", () => {
    const css = sanitizeDictionaryCss("@import 'https://bad.test/a.css'; .x{background:url(https://bad.test/x);position:fixed}");
    expect(css).not.toContain("https://");
    expect(css).not.toContain("@import");
    expect(css).toContain("background:none");
    expect(css).toContain("position: static");
  });
});
