import en from "./en.json";
import zh_TW from "./zh-TW.json";
import ja from "./ja.json";
import ko from "./ko.json";
import fr from "./fr.json";
import de from "./de.json";
import es from "./es.json";
import pt from "./pt.json";
import ru from "./ru.json";
import it from "./it.json";
import ar from "./ar.json";
import th from "./th.json";
import vi from "./vi.json";

export const catalogs: Record<string, Record<string, string>> = {
  "en": en,
  "zh-TW": zh_TW,
  "ja": ja,
  "ko": ko,
  "fr": fr,
  "de": de,
  "es": es,
  "pt": pt,
  "ru": ru,
  "it": it,
  "ar": ar,
  "th": th,
  "vi": vi,
  "zh-CN": Object.fromEntries(Object.keys(en).map((key) => [key, key]))
};
