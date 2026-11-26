import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_SETTINGS } from "./shared/settings";
import { catalogs } from "./shared/locales/catalogs";
import { UI_LANGUAGES, setUiLanguage } from "./shared/i18n";

const preview = vi.hoisted(() => ({ stateIndex: 0, category: "general" }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => {
    const index = preview.stateIndex++;
    return react.useState(index === 0 ? DEFAULT_SETTINGS : index === 1 ? true : index === 2 ? preview.category : initial);
  } };
});
import { App } from "./options";

function render(language: string, category = "general") {
  preview.stateIndex = 0;
  preview.category = category;
  setUiLanguage(language);
  return renderToStaticMarkup(<App />);
}

describe("localized settings surface", () => {
  for (const [language] of UI_LANGUAGES) {
    it(`renders ${language} with the product logo and a separate interface language selector`, () => {
      const html = render(language);
      const catalog = catalogs[language]!;
      expect(html).toContain('src="icons/logo.svg"');
      expect(html).toContain('id="ui-language"');
      expect(html).toContain(catalog["界面语言"]);
      expect(html).toContain(catalog["所有更改已保存"]);
      expect(html).toContain('id="target-language"');
      expect(html).not.toContain('type="submit"');
      const languageOptions = html.match(/<select id="ui-language"[\s\S]*?<\/select>/)?.[0];
      expect(languageOptions?.match(/<option /g)).toHaveLength(14);
    });
  }

  it("has no Chinese UI remnants in English apart from native language names", () => {
    const html = render("en", "subtitles").replace(/<select id="ui-language"[\s\S]*?<\/select>/, "");
    expect(html).not.toMatch(/\p{Script=Han}/u);
    expect(html).toContain("Subtitle behavior");
  });
});

it("combines subtitle services with Chrome selected and removes redundant controls", () => {
  const html = render("en", "services");
  expect(html).not.toContain('id="service-mode"');
  expect(html).not.toContain('permission-note');
  expect(html).not.toContain('value="baidu-free"');
  expect(html).not.toContain('value="deepl-free"');
  const providers = html.match(/<select id="provider"[\s\S]*?<\/select>/)?.[0];
  expect(providers).toContain('value="chrome-local" selected=""');
  expect(providers).not.toContain('value="hy-mt-local"');
  expect(html).toContain('id="analysis-service-mode"');
});
