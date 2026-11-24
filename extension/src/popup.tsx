import { KEYLESS_PROVIDERS } from "./shared/service-mode";
import { t, initializeI18n } from "./shared/i18n";
import { useI18n } from "./shared/use-i18n";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getSettings, updateSettings } from "./shared/settings";
import type { ExtensionSettings, TranslationProvider } from "./shared/types";

function App() {
  useI18n();
  const [settings, setSettings] = useState<ExtensionSettings>();
  const [message, setMessage] = useState("正在读取设置…");

  useEffect(() => {
    void Promise.all([getSettings(), chrome.tabs.query({ active: true, currentWindow: true })]).then(
      ([loaded, tabs]) => {
        setSettings(loaded);
        const isYouTube = tabs[0]?.url?.startsWith("https://www.youtube.com/");
        setMessage(isYouTube ? "已连接当前 YouTube 页面" : "打开 YouTube 视频后即可使用");
      }
    );
  }, []);

  async function patch(value: Partial<ExtensionSettings>) {
    const next = await updateSettings(value);
    setSettings(next);
  }

  if (!settings) return <div className="app"><div className="brand">Tubitle</div><p className="muted">{t("正在加载…")}</p></div>;
  return (
    <div className="app">
      <div className="brand">Tubitle</div>
      <p className="muted">{t("沉浸式双语字幕")}</p>
      <div className="status">{t(message)}</div>
      <div className="row">
        <span>{t("启用字幕插件")}</span>
        <button className={`toggle ${settings.enabled ? "on" : ""}`} onClick={() => void patch({ enabled: !settings.enabled })} aria-label={t("启用字幕插件")}><span /></button>
      </div>
      <div className="row">
        <span>{t("显示翻译")}</span>
        <button className={`toggle ${settings.showChinese ? "on" : ""}`} onClick={() => void patch({ showChinese: !settings.showChinese })} aria-label={t("显示翻译")}><span /></button>
      </div>
      <div className="row"><span>{t("服务方式")}</span><span>{settings.serviceMode === "tubitle" ? "Tubitle" : t("自备 API")}</span></div>
      {settings.serviceMode === "custom" && <div className="row">
        <label htmlFor="provider">{t("翻译引擎")}</label>
        <select id="provider" value={settings.provider} onChange={(event) => void patch({ provider: event.target.value as TranslationProvider })}>
          {KEYLESS_PROVIDERS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          <option value="microsoft">Microsoft</option>
          <option value="google">Google Cloud</option>
        </select>
      </div>
      }
      <button className="primary" onClick={() => void chrome.runtime.openOptionsPage()}>{t("完整设置")}</button>
    </div>
  );
}

initializeI18n(true);
createRoot(document.getElementById("root")!).render(<App />);
