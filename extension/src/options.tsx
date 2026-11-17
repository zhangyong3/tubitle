import { normalizeHistoryDays } from "./shared/history-retention";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { LANGUAGES } from "./shared/languages";
import { DEFAULT_SETTINGS, getSettings, MAX_AUTO_RETURN_SECONDS, updateSettings } from "./shared/settings";
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
import { translationProvider } from "./shared/service-mode";

const shortcutLabels: Record<keyof ShortcutSettings, string> = {
  previous: "上一句",
  next: "下一句",
  repeat: "重复当前句",
  toggleTranslation: "显示/隐藏翻译",
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
    if (settings.serviceMode !== "custom") return true;
    const origins = [
      settings.provider === "microsoft" && settings.microsoftTranslatorKey.trim() && settings.microsoftTranslatorEndpoint,
      settings.llmApiKey.trim() && settings.llmBaseUrl
    ].filter((value): value is string => typeof value === "string" && !!value).map((value) => {
      const url = new URL(value);
      return `${url.protocol}//${url.host}/*`;
    });
    return origins.length === 0 || chrome.permissions.request({ origins });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const normalized = {
        ...form,
        provider: translationProvider(form.serviceMode, form.provider),
        microsoftTranslatorEndpoint: form.microsoftTranslatorEndpoint.trim().replace(/\/+$/, ""),
        llmBaseUrl: form.llmBaseUrl.trim().replace(/\/+$/, ""),
        tencentConcurrency: Math.min(5, Math.max(1, Math.round(form.tencentConcurrency) || 3)),
        historyRetentionDays: normalizeHistoryDays(form.historyRetentionDays)
      };
      if (!await requestApiPermissions(normalized)) throw new Error("需要先允许访问所配置的 API 域名");
      setForm(await updateSettings(normalized));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "保存失败");
    }
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
      setDictionaryMessage("已移除离线词典。查词时仍可查看 Open English WordNet 释义。");
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
      <p className="lead">默认使用 Tubitle 服务，无需填写 API Key。自备 API 的密钥仅保存在本机浏览器，不会上传到 Tubitle。</p>
      <form onSubmit={submit}>
        <section className="card">
          <h2>服务方式</h2>
          <div className="field">
            <label htmlFor="service-mode">字幕翻译与 AI 语句分析</label>
            <select id="service-mode" value={form.serviceMode} onChange={(event) => {
              const mode = event.target.value === "custom" ? "custom" : "tubitle";
              setForm({ ...form, serviceMode: mode, provider: translationProvider(mode, form.provider) });
              setProviderMessage("");
            }}>
              <option value="tubitle">使用 Tubitle 服务（默认）</option>
              <option value="custom">使用自己的 API Key</option>
            </select>
          </div>
          <p className="hint">{form.serviceMode === "tubitle"
            ? "由 Tubitle 提供字幕翻译与 AI 语句分析。AI 解析需登录，免费版每天 3 次，Pro 每天 100 次。"
            : "字幕与句子直接发送到你选择的服务商，费用由服务商收取，不消耗 Tubitle 额度。登录后学习记录仍会自动同步。"}</p>
        </section>
        {form.serviceMode === "custom" && <>
        <section className="card">
          <h2>字幕翻译 API</h2>
          <div className="field">
            <label htmlFor="provider">翻译服务商</label>
            <select id="provider" value={form.provider} onChange={(event) => { setForm({ ...form, provider: event.target.value as TranslationProvider }); setProviderMessage(""); }}>
              <option value="microsoft">Microsoft Translator</option>
              <option value="google">Google Cloud Translation</option>
            </select>
          </div>
          {form.provider === "microsoft" ? <>
          <h3>Microsoft Translator</h3>
          <div className="grid">
            <div className="field"><label htmlFor="ms-key">Subscription Key</label><input id="ms-key" type="password" value={form.microsoftTranslatorKey} onChange={(event) => setForm({ ...form, microsoftTranslatorKey: event.target.value })} autoComplete="off" /></div>
            <div className="field"><label htmlFor="ms-region">Region</label><input id="ms-region" value={form.microsoftTranslatorRegion} onChange={(event) => setForm({ ...form, microsoftTranslatorRegion: event.target.value })} /></div>
            <div className="field full"><label htmlFor="ms-endpoint">Endpoint</label><input id="ms-endpoint" type="url" value={form.microsoftTranslatorEndpoint} onChange={(event) => setForm({ ...form, microsoftTranslatorEndpoint: event.target.value })} /></div>
          </div>
          <div className="actions"><button className="secondary" type="button" onClick={() => void testProvider("microsoft")}>测试 Microsoft</button></div>
          </> : <>
          <h3>Google Cloud Translation</h3>
          <div className="grid"><div className="field full"><label htmlFor="google-key">API Key</label><input id="google-key" type="password" value={form.googleTranslateApiKey} onChange={(event) => setForm({ ...form, googleTranslateApiKey: event.target.value })} autoComplete="off" /></div></div>
          <div className="actions"><button className="secondary" type="button" onClick={() => void testProvider("google")}>测试 Google</button></div>
          </>}
        </section>
        <section className="card">
          <h2>AI 语句分析 API</h2>
          <p className="hint">填写 OpenAI 兼容接口的地址、API Key 和模型名称。无需登录 Tubitle 即可使用自备 API 解析句子。</p>
          <div className="grid">
            <div className="field full"><label htmlFor="llm-base">API Base URL</label><input id="llm-base" type="url" value={form.llmBaseUrl} onChange={(event) => setForm({ ...form, llmBaseUrl: event.target.value })} /></div>
            <div className="field"><label htmlFor="llm-key">API Key</label><input id="llm-key" type="password" value={form.llmApiKey} onChange={(event) => setForm({ ...form, llmApiKey: event.target.value })} autoComplete="off" /></div>
            <div className="field"><label htmlFor="llm-model">Model</label><input id="llm-model" value={form.llmModel} onChange={(event) => setForm({ ...form, llmModel: event.target.value })} /></div>
          </div>
          <div className="actions"><button className="secondary" type="button" onClick={() => void testProvider("llm")}>测试大模型</button></div>
        </section>
        </>}
        {providerMessage && <p className="hint" role="status">{providerMessage}</p>}
        <section className="card">
          <h2>翻译语言</h2>
          <div className="field"><label htmlFor="target-language">目标语言</label>
            <select id="target-language" value={form.targetLanguage} onChange={(event) => setForm({ ...form, targetLanguage: event.target.value })}>
              {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </div>
          <fieldset><legend>不需要翻译的语言（多选）</legend><div className="grid">
            {LANGUAGES.filter(([code]) => code !== "zh-TW").map(([code, label]) => <label key={code}>
              <input type="checkbox" checked={form.excludedLanguages.includes(code)} onChange={(event) => setForm({ ...form, excludedLanguages: event.target.checked ? [...form.excludedLanguages, code] : form.excludedLanguages.filter((item) => item !== code) })} /> {code === "zh" ? "中文（简体及繁体）" : label}
            </label>)}
          </div></fieldset>
          <p className="hint">所选语言及与目标语言相同的字幕只显示原文，不请求翻译。</p>
          <h2>字幕交互</h2>
          <div className="grid">
            <label><input type="checkbox" checked={form.showChinese} onChange={(event) => setForm({ ...form, showChinese: event.target.checked })} /> 默认显示翻译</label>
            <label><input type="checkbox" checked={form.hoverPause} onChange={(event) => setForm({ ...form, hoverPause: event.target.checked })} /> 悬停字幕时暂停</label>
            <label><input type="checkbox" checked={form.resumeAfterHover} onChange={(event) => setForm({ ...form, resumeAfterHover: event.target.checked })} /> 离开后恢复播放</label>
            <div className="field">
              <label htmlFor="auto-return-subtitles">自动返回字幕（秒）</label>
              <input id="auto-return-subtitles" type="number" min="0" max={MAX_AUTO_RETURN_SECONDS} step="1" required
                aria-describedby="auto-return-subtitles-hint"
                value={Number.isNaN(form.autoReturnToSubtitlesSeconds) ? "" : form.autoReturnToSubtitlesSeconds}
                onChange={(event) => setForm({ ...form, autoReturnToSubtitlesSeconds: event.target.valueAsNumber })} />
              <span className="hint" id="auto-return-subtitles-hint">仅在视频正常播放时计时。默认 10 秒，填 0 关闭。</span>
            </div>
          </div>
        </section>
        <section className="card">
          <h2>字幕样式</h2>
          <div className="grid">
            <div className="field">
              <label htmlFor="english-size">原文字号：{form.subtitleAppearance.englishFontSize}px</label>
              <input id="english-size" type="range" min="14" max="48" value={form.subtitleAppearance.englishFontSize} onChange={(event) => setForm({ ...form, subtitleAppearance: { ...form.subtitleAppearance, englishFontSize: Number(event.target.value) } })} />
            </div>
            <div className="field">
              <label htmlFor="chinese-size">译文字号：{form.subtitleAppearance.chineseFontSize}px</label>
              <input id="chinese-size" type="range" min="12" max="42" value={form.subtitleAppearance.chineseFontSize} onChange={(event) => setForm({ ...form, subtitleAppearance: { ...form.subtitleAppearance, chineseFontSize: Number(event.target.value) } })} />
            </div>
            <div className="field">
              <label htmlFor="english-color">原文颜色</label>
              <input id="english-color" type="color" value={form.subtitleAppearance.englishColor} onChange={(event) => setForm({ ...form, subtitleAppearance: { ...form.subtitleAppearance, englishColor: event.target.value } })} />
            </div>
            <div className="field">
              <label htmlFor="chinese-color">译文颜色</label>
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
          ) : <p className="hint">选择包含 MDX、CSS 和 MDD 的词典目录，扩展会自动识别并导入。未设置时，查词页会隐藏离线词典。</p>}
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
              <label htmlFor="history-limit">最多保存天数</label>
              <input id="history-limit" type="number" min="1" max="365" value={form.historyRetentionDays} onChange={(event) => setForm({ ...form, historyRetentionDays: Number(event.target.value) })} />
              <span className="hint">按本地日期保留最近 1–365 天（含今天）的查词、翻译和分析记录，默认 30 天。过期记录自动清理；不影响已上传的网页记录。</span>
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
