import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getSettings, updateSettings } from "./shared/settings";
import type { ExtensionSettings, TranslationProvider } from "./shared/types";

function App() {
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

  if (!settings) return <div className="app"><div className="brand">Tubitle</div><p className="muted">正在加载…</p></div>;
  return (
    <div className="app">
      <div className="brand">Tubitle</div>
      <p className="muted">沉浸式英中双语字幕</p>
      <div className="status">{message}</div>
      <div className="row">
        <span>启用字幕插件</span>
        <button className={`toggle ${settings.enabled ? "on" : ""}`} onClick={() => void patch({ enabled: !settings.enabled })} aria-label="启用字幕插件"><span /></button>
      </div>
      <div className="row">
        <span>显示中文翻译</span>
        <button className={`toggle ${settings.showChinese ? "on" : ""}`} onClick={() => void patch({ showChinese: !settings.showChinese })} aria-label="显示中文翻译"><span /></button>
      </div>
      <div className="row">
        <label htmlFor="provider">翻译引擎</label>
        <select id="provider" value={settings.provider} onChange={(event) => void patch({ provider: event.target.value as TranslationProvider })}>
          <option value="microsoft">Microsoft</option>
          <option value="google">Google Cloud</option>
          <option value="tencent">腾讯云</option>
        </select>
      </div>
      <button className="primary" onClick={() => void chrome.runtime.openOptionsPage()}>完整设置</button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
