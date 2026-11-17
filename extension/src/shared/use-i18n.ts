import { useSyncExternalStore } from "react";
import { getUiLanguage, subscribeUiLanguage } from "./i18n";

export function useI18n() {
  return useSyncExternalStore(subscribeUiLanguage, getUiLanguage, getUiLanguage);
}
