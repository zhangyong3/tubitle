import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_SETTINGS, getSettings, updateSettings } from "./shared/settings";
import {
  removeOfflineDictionary,
  removeOfflineDictionaryCss,
  removeOfflineDictionaryResources,
  saveOfflineDictionary,
  saveOfflineDictionaryCss,
  saveOfflineDictionaryResources
} from "./shared/offline-dictionary";
import type { ExtensionSettings, ShortcutSettings, TranslationProvider } from "./shared/types";
import { selectDictionaryDirectoryFiles } from "./shared/dictionary-directory";
import { sendMessage } from "./shared/messaging";

const shortcutLabels: Record<keyof ShortcutSettings, string> = {
  previous: "上一句",
  next: "下一句",
  repeat: "重复当前句",
  toggleTranslation: "显示/隐藏中文",
  analyze: "解析当前句"
};

function App() {
  const [form, setForm] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dictionaryBusy, setDictionaryBusy] = useState(false);
  const [dictionaryMessage, setDictionaryMessage] = useState("");
  const [providerMessage, setProviderMessage] = useState("");
  const dictionaryDirectoryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSettings().then((settings) => {
      setForm(settings);
      setLoaded(true);
    });
  }, []);

  async function requestApiPermissions(settings: ExtensionSettings): Promise<boolean> {
    const origins = [settings.microsoftTranslatorEndpoint, settings.llmBaseUrl].filter(Boolean).map((value) => {
      const url = new URL(value);
      return `${url.protocol}//${url.host}/*`;
    });
    return origins.length === 0 || chrome.permissions.request({ origins });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = {
      ...form,
      microsoftTranslatorEndpoint: form.microsoftTranslatorEndpoint.trim().replace(/\/+$/, ""),
      llmBaseUrl: form.llmBaseUrl.trim().replace(/\/+$/, ""),
      tencentConcurrency: Math.min(5, Math.max(1, Math.round(form.tencentConcurrency) || 3)),
      historyLimit: Math.min(100, Math.max(1, Math.round(form.historyLimit) || DEFAULT_SETTINGS.historyLimit))
    };
    if (!await requestApiPermissions(normalized)) return;
    setForm(await updateSettings(normalized));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  async function testProvider(provider: TranslationProvider | "llm") {
    setProviderMessage("正在测试连接…");
    try {
      if (!await requestApiPermissions(form)) throw new Error("需要先允许访问所配置的 API 域名");
      await updateSettings(form);
      await sendMessage({ type: "TEST_PROVIDER", provider });
      setProviderMessage("连接成功 ✓");
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "连接失败");
    }
  }

  function setShortcut(name: keyof ShortcutSettings, value: string) {
    setForm((current) => ({ ...current, shortcuts: { ...current.shortcuts, [name]: value } }));
  }

  async function chooseDictionaryDirectory(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    setDictionaryBusy(true);
    setDictionaryMessage("正在扫描并导入词典目录…");
    try {
      const { mdx, css, mddFiles, directoryName } = selectDictionaryDirectoryFiles(files);
      await navigator.storage.persist?.();
      const dictionaryMetadata = await saveOfflineDictionary(mdx);
      const cssMetadata = css
        ? await saveOfflineDictionaryCss(css)
        : (await removeOfflineDictionaryCss(), { configured: false, name: "", size: 0, lastModified: 0 });
      const resourceMetadata = mddFiles.length > 0
        ? await saveOfflineDictionaryResources(mddFiles)
        : (await removeOfflineDictionaryResources(), { configured: false, files: [] });
      setForm(await updateSettings({
        offlineDictionary: dictionaryMetadata,
        offlineDictionaryCss: cssMetadata,
        offlineDictionaryResources: resourceMetadata,
        offlineDictionaryDirectory: { name: directoryName, lastImported: Date.now() }
      }));
      const extras = [css ? `CSS：${css.name}` : "未找到 CSS", `${mddFiles.length} 个 MDD`].join("，");
      setDictionaryMessage(`目录导入完成。MDX：${mdx.name}，${extras}。`);
    } catch (error) {
      setDictionaryMessage(error instanceof Error ? error.message : "导入词典目录失败");
    } finally {
      setDictionaryBusy(false);
    }
  }

  async function removeDictionary() {
    setDictionaryBusy(true);
    try {
      await removeOfflineDictionary();
      await removeOfflineDictionaryCss();
      await removeOfflineDictionaryResources();
      setForm(await updateSettings({
        offlineDictionary: { configured: false, name: "", size: 0, lastModified: 0 },
        offlineDictionaryCss: { configured: false, name: "", size: 0, lastModified: 0 },
        offlineDictionaryResources: { configured: false, files: [] },
        offlineDictionaryDirectory: { name: "", lastImported: 0 }
      }));
      setDictionaryMessage("已移除离线词典，将恢复使用 LDOCE 在线查询。");
    } catch (error) {
      setDictionaryMessage(error instanceof Error ? error.message : "移除离线词典失败");
    } finally {
      setDictionaryBusy(false);
    }
  }

  if (!loaded) return <main className="page"><p>正在加载设置…</p></main>;
  return (
    <main className="page">
      <h1>Tubitle 设置</h1>
      <p className="lead">纯本地扩展版本。翻译和大模型密钥仅保存在本机浏览器，不经过 Tubitle 服务端，也不会同步到 Chrome 云端。</p>
      <form onSubmit={submit}>
        <section className="card">
          <h2>翻译服务</h2>
          <div className="grid">
            <div className="field">
              <label htmlFor="provider">默认翻译引擎</label>
              <select id="provider" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value as TranslationProvider })}>
                <option value="microsoft">Microsoft Translator</option>
                <option value="google">Google Cloud Translation</option>
                <option value="tencent">腾讯云机器翻译</option>
              </select>
            </div>
          </div>
          <h3>腾讯云机器翻译</h3>
          <div className="grid">
            <div className="field"><label htmlFor="tencent-id">Secret ID</label><input id="tencent-id" type="password" value={form.tencentSecretId} onChange={(event) => setForm({ ...form, tencentSecretId: event.target.value })} autoComplete="off" /></div>
            <div className="field"><label htmlFor="tencent-key">Secret Key</label><input id="tencent-key" type="password" value={form.tencentSecretKey} onChange={(event) => setForm({ ...form, tencentSecretKey: event.target.value })} autoComplete="off" /></div>
            <div className="field"><label htmlFor="tencent-region">地域</label><input id="tencent-region" value={form.tencentRegion} onChange={(event) => setForm({ ...form, tencentRegion: event.target.value })} /></div>
            <div className="field"><label htmlFor="tencent-concurrency">并发数：{form.tencentConcurrency}</label><input id="tencent-concurrency" type="range" min="1" max="5" value={form.tencentConcurrency} onChange={(event) => setForm({ ...form, tencentConcurrency: Number(event.target.value) })} /></div>
          </div>
          <div className="actions"><button className="secondary" type="button" onClick={() => void testProvider("tencent")}>测试腾讯云</button></div>
          <h3>Microsoft Translator</h3>
          <div className="grid">
            <div className="field"><label htmlFor="ms-key">Subscription Key</label><input id="ms-key" type="password" value={form.microsoftTranslatorKey} onChange={(event) => setForm({ ...form, microsoftTranslatorKey: event.target.value })} autoComplete="off" /></div>
            <div className="field"><label htmlFor="ms-region">Region</label><input id="ms-region" value={form.microsoftTranslatorRegion} onChange={(event) => setForm({ ...form, microsoftTranslatorRegion: event.target.value })} /></div>
            <div className="field full"><label htmlFor="ms-endpoint">Endpoint</label><input id="ms-endpoint" type="url" value={form.microsoftTranslatorEndpoint} onChange={(event) => setForm({ ...form, microsoftTranslatorEndpoint: event.target.value })} /></div>
          </div>
          <div className="actions"><button className="secondary" type="button" onClick={() => void testProvider("microsoft")}>测试 Microsoft</button></div>
          <h3>Google Cloud Translation</h3>
          <div className="grid"><div className="field full"><label htmlFor="google-key">API Key</label><input id="google-key" type="password" value={form.googleTranslateApiKey} onChange={(event) => setForm({ ...form, googleTranslateApiKey: event.target.value })} autoComplete="off" /></div></div>
          <div className="actions"><button className="secondary" type="button" onClick={() => void testProvider("google")}>测试 Google</button></div>
          {providerMessage && <p className="hint">{providerMessage}</p>}
        </section>
        <section className="card">
          <h2>AI 语句分析</h2>
          <div className="grid">
            <div className="field full"><label htmlFor="llm-base">API Base URL</label><input id="llm-base" type="url" value={form.llmBaseUrl} onChange={(event) => setForm({ ...form, llmBaseUrl: event.target.value })} /></div>
            <div className="field"><label htmlFor="llm-key">API Key</label><input id="llm-key" type="password" value={form.llmApiKey} onChange={(event) => setForm({ ...form, llmApiKey: event.target.value })} autoComplete="off" /></div>
            <div className="field"><label htmlFor="llm-model">Model</label><input id="llm-model" value={form.llmModel} onChange={(event) => setForm({ ...form, llmModel: event.target.value })} /></div>
          </div>
          <div className="actions"><button className="secondary" type="button" onClick={() => void testProvider("llm")}>测试大模型</button></div>
        </section>
        <section className="card">
          <h2>字幕交互</h2>
          <div className="grid">
            <label><input type="checkbox" checked={form.showChinese} onChange={(event) => setForm({ ...form, showChinese: event.target.checked })} /> 默认显示中文翻译</label>
            <label><input type="checkbox" checked={form.hoverPause} onChange={(event) => setForm({ ...form, hoverPause: event.target.checked })} /> 悬停字幕时暂停</label>
            <label><input type="checkbox" checked={form.resumeAfterHover} onChange={(event) => setForm({ ...form, resumeAfterHover: event.target.checked })} /> 离开后恢复播放</label>
          </div>
        </section>
        <section className="card">
          <h2>字幕样式</h2>
          <div className="grid">
            <div className="field">
              <label htmlFor="english-size">英文字号：{form.subtitleAppearance.englishFontSize}px</label>
              <input id="english-size" type="range" min="14" max="48" value={form.subtitleAppearance.englishFontSize} onChange={(event) => setForm({ ...form, subtitleAppearance: { ...form.subtitleAppearance, englishFontSize: Number(event.target.value) } })} />
            </div>
            <div className="field">
              <label htmlFor="chinese-size">中文字号：{form.subtitleAppearance.chineseFontSize}px</label>
              <input id="chinese-size" type="range" min="12" max="42" value={form.subtitleAppearance.chineseFontSize} onChange={(event) => setForm({ ...form, subtitleAppearance: { ...form.subtitleAppearance, chineseFontSize: Number(event.target.value) } })} />
            </div>
            <div className="field">
              <label htmlFor="english-color">英文颜色</label>
              <input id="english-color" type="color" value={form.subtitleAppearance.englishColor} onChange={(event) => setForm({ ...form, subtitleAppearance: { ...form.subtitleAppearance, englishColor: event.target.value } })} />
            </div>
            <div className="field">
              <label htmlFor="chinese-color">中文颜色</label>
              <input id="chinese-color" type="color" value={form.subtitleAppearance.chineseColor} onChange={(event) => setForm({ ...form, subtitleAppearance: { ...form.subtitleAppearance, chineseColor: event.target.value } })} />
            </div>
          </div>
          <div className="actions"><button type="button" onClick={() => setForm({ ...form, subtitlePosition: DEFAULT_SETTINGS.subtitlePosition })}>恢复默认字幕位置</button></div>
          <p className="hint">字幕默认位于播放器中下方。播放时也可以从字幕框的空白处拖动，位置会自动保存。</p>
        </section>
        <section className="card">
          <h2>离线词典</h2>
          <input ref={dictionaryDirectoryInput} hidden multiple type="file" {...({ webkitdirectory: "" } as { webkitdirectory: string })} onChange={(event) => void chooseDictionaryDirectory(event)} />
          {form.offlineDictionary.configured ? (
            <div>
              <p><strong>{form.offlineDictionaryDirectory.name || "已导入的词典目录"}</strong></p>
              <p className="hint">MDX：{form.offlineDictionary.name}（{formatFileSize(form.offlineDictionary.size)}）</p>
              <p className="hint">CSS：{form.offlineDictionaryCss.configured ? `${form.offlineDictionaryCss.name}（${formatFileSize(form.offlineDictionaryCss.size)}）` : "未找到"}</p>
              <p className="hint">MDD：{form.offlineDictionaryResources.configured
                ? form.offlineDictionaryResources.files.map((file) => `${file.name}（${formatFileSize(file.size)}）`).join("、")
                : "未找到"}</p>
              <p className="hint">目录内的匹配文件已复制到浏览器扩展存储，不会上传到服务。</p>
            </div>
          ) : <p className="hint">选择包含 MDX、CSS 和 MDD 的词典目录，扩展会自动识别并导入；未设置时继续打开 LDOCE。</p>}
          <div className="actions">
            <button type="button" disabled={dictionaryBusy} onClick={() => dictionaryDirectoryInput.current?.click()}>{form.offlineDictionary.configured ? "重新选择词典目录" : "选择词典目录"}</button>
            {form.offlineDictionary.configured && <button type="button" disabled={dictionaryBusy} onClick={() => void removeDictionary()}>移除离线词典</button>}
          </div>
          {dictionaryMessage && <p className="hint">{dictionaryMessage}</p>}
        </section>
        <section className="card">
          <h2>学习面板历史</h2>
          <div className="grid">
            <div className="field">
              <label htmlFor="history-limit">每类保留数量</label>
              <input id="history-limit" type="number" min="1" max="100" value={form.historyLimit} onChange={(event) => setForm({ ...form, historyLimit: Number(event.target.value) })} />
              <span className="hint">分别保留最近的查词和语句分析记录，最多各 100 条。</span>
            </div>
          </div>
        </section>
        <section className="card">
          <h2>快捷键</h2>
          <div className="grid">
            {(Object.keys(shortcutLabels) as Array<keyof ShortcutSettings>).map((name) => (
              <div className="field" key={name}>
                <label htmlFor={`shortcut-${name}`}>{shortcutLabels[name]}</label>
                <input id={`shortcut-${name}`} value={form.shortcuts[name]} onChange={(event) => setShortcut(name, event.target.value)} placeholder="Alt+R" />
              </div>
            ))}
          </div>
          <p className="hint">格式示例：Alt+ArrowLeft、Alt+R、Ctrl+Shift+A。若与系统或浏览器快捷键冲突，请在此修改。</p>
        </section>
        <div className="actions"><button type="submit">保存设置</button>{saved && <span className="saved">已保存</span>}</div>
      </form>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
