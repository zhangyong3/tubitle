import { catalogs } from "./locales/catalogs";

import { resolveUiLanguage, type UiLanguage } from "./ui-language";
export { UI_LANGUAGES, resolveUiLanguage, type UiLanguage } from "./ui-language";
let language = resolveUiLanguage(typeof navigator === "undefined" ? "en" : navigator.language);
const subscribers = new Set<() => void>();
export const getUiLanguage = () => language;
export function setUiLanguage(value: string) {
  const next = resolveUiLanguage(value);
  if (next === language) return;
  language = next;
  for (const listener of subscribers) listener();
}
export function subscribeUiLanguage(listener: () => void) {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}
let initialized = false;
export function initializeI18n(updateDocument = false) {
  if (updateDocument) {
    const update = () => {
      document.documentElement.lang = language;
      document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
      document.title = t(document.body.dataset.title || "Tubitle");
    };
    subscribeUiLanguage(update);
    update();
  }
  if (initialized) return;
  initialized = true;
  void chrome.storage.local.get("settings").then((result) => {
    setUiLanguage(result.settings?.uiLanguage || navigator.language);
  }).catch(() => undefined);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) setUiLanguage(changes.settings.newValue?.uiLanguage || navigator.language);
  });
}

const templateSources = Object.keys(catalogs.en!).filter((source) => /\{\d+\}/.test(source));
const templateMatchers = templateSources.map((source) => ({
  source,
  pattern: new RegExp("^" + source.split(/(\{\d+\})/).map((part) => /^\{\d+\}$/.test(part) ? "([\\s\\S]*?)" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("") + "$"),
  indexes: [...source.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1]))
}));

/** Chinese source keys remain stable; only known product messages are translated. */
export function translateForLanguage(locale: UiLanguage, source: string, ...values: Array<string | number>): string {
  let key = source;
  if (values.length === 0 && !catalogs.en![key]) {
    for (const template of templateMatchers) {
      const match = template.pattern.exec(source);
      if (!match) continue;
      key = template.source;
      template.indexes.forEach((index, position) => { values[index] = match[position + 1]!; });
      break;
    }
  }
  // Service errors may nest another known error or provider label. Do not
  // transform parameters in regular messages, where they can be user content.
  if (/(?:错误|失败|无法下载)/.test(key)) {
    values = values.map((value) => typeof value === "string" && catalogs.en![value] ? translateForLanguage(locale, value) : value);
  }
  const translated = locale === "zh-CN" ? key : catalogs[locale]?.[key] || catalogs.en![key] || key;
  return translated.replace(/\{(\d+)\}/g, (token, index: string) => String(values[Number(index)] ?? token));
}

export function t(source: string, ...values: Array<string | number>): string {
  return translateForLanguage(language, source, ...values);
}
