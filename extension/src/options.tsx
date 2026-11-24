import { keylessRequest } from "./keyless-providers";
import { translateInChrome } from "./shared/chrome-translator";
import { t, initializeI18n, UI_LANGUAGES, setUiLanguage, getUiLanguage } from "./shared/i18n";
import { useI18n } from "./shared/use-i18n";
import { createSettingsAutosave } from "./shared/settings-autosave";
import { normalizeHistoryDays } from "./shared/history-retention";
import { useEffect, useRef, useState, type ChangeEvent, type SetStateAction, type FocusEvent } from "react";
import { createRoot } from "react-dom/client";
import { LANGUAGES } from "./shared/languages";
import { DEFAULT_SETTINGS, getSettings, MAX_AUTO_RETURN_SECONDS, normalizeAutoReturnSeconds, updateSettings } from "./shared/settings";
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
import { KEYLESS_PROVIDERS, isKeylessProvider, translationProvider } from "./shared/service-mode";

const categories = [
  { id: "general", label: "常规", icon: "settings", description: "管理学习记录与使用偏好。" },
  { id: "subtitles", label: "字幕", icon: "subtitles", description: "选择翻译语言，调整字幕交互与外观。", children: [
    { id: "language", label: "翻译语言" }, { id: "interaction", label: "字幕交互" }, { id: "appearance", label: "字幕样式" }
  ] },
  { id: "services", label: "服务与 API", icon: "services", description: "选择字幕翻译和 AI 语句分析的服务方式。" },
  { id: "dictionary", label: "离线词典", icon: "dictionary", description: "导入本地词典，随时查阅单词释义。" },
  { id: "shortcuts", label: "快捷键", icon: "shortcuts", description: "按你的习惯设置播放与学习快捷键。" }
] as const;
type CategoryId = typeof categories[number]["id"];

function languageName(code: string) {
  return new Intl.DisplayNames([getUiLanguage()], { type: "language" }).of(code === "zh" ? "zh-Hans" : code) || code;
}

function CategoryIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
    subtitles: "M4 5h16v14H4zM7 10h4m2 0h4M7 14h10",
    services: "m9 4-5 8 5 8m6-16 5 8-5 8M13 5l-2 14",
    dictionary: "M12 6C9 4 5 4 3 5v14c3-1 6-1 9 1m0-14c3-2 7-2 9-1v14c-3-1-6-1-9 1V6Z",
    shortcuts: "M3 6h18v12H3zM6 10h1m3 0h1m3 0h1m3 0h.1M7 14h10"
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

const shortcutLabels: Record<keyof ShortcutSettings, string> = {
  previous: "上一句",
  next: "下一句",
  repeat: "重复当前句",
  toggleTranslation: "显示/隐藏翻译",
  analyze: "解析当前句"
};

export function App() {
  const uiLanguage = useI18n();
  const [form, setFormState] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryId>("general");
  const [saveStatus, setSaveStatus] = useState("所有更改已保存");
  const formRef = useRef(form);
  const autosave = useRef(createSettingsAutosave(updateSettings));
  const revision = useRef(0);
  const [dictionaryBusy, setDictionaryBusy] = useState(false);
  const [dictionaryMessage, setDictionaryMessage] = useState("");
  const [providerMessage, setProviderMessage] = useState("");
  const dictionaryDirectoryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    formRef.current = { ...formRef.current, uiLanguage };
    setFormState((current) => ({ ...current, uiLanguage }));
  }, [uiLanguage]);

  useEffect(() => {
    void getSettings().then((settings) => {
      formRef.current = settings;
      setFormState(settings);
      setLoaded(true);
    });
  }, []);

  async function requestApiPermissions(settings: ExtensionSettings, forProvider?: TranslationProvider | "llm"): Promise<boolean> {
    const origins = [
      (forProvider === undefined || forProvider === "microsoft") && settings.serviceMode === "custom" && settings.provider === "microsoft" && settings.microsoftTranslatorKey.trim() && settings.microsoftTranslatorEndpoint,
      (forProvider === undefined || forProvider === settings.provider) && settings.serviceMode === "custom" && isKeylessProvider(settings.provider) && settings.provider !== "chrome-local" && keylessRequest(settings.provider, "Test", "en", "zh").url,
      (forProvider === undefined || forProvider === "llm") && settings.analysisServiceMode === "custom" && settings.llmApiKey.trim() && settings.llmBaseUrl
    ].filter((value): value is string => typeof value === "string" && !!value).map((value) => {
      const url = new URL(value);
      return `${url.protocol}//${url.host}/*`;
    });
    return origins.length === 0 || chrome.permissions.request({ origins });
  }

  // Serialize patches so rapid edits cannot overwrite one another or dictionary imports.
  function setForm(action: SetStateAction<ExtensionSettings>) {
    const current = formRef.current;
    const next = typeof action === "function" ? action(current) : action;
    const patch: Partial<ExtensionSettings> = {};
    for (const key of Object.keys(next) as Array<keyof ExtensionSettings>) {
      if (JSON.stringify(current[key]) !== JSON.stringify(next[key])) {
        Object.assign(patch, { [key]: next[key] });
      }
    }
    if (next.uiLanguage !== current.uiLanguage) setUiLanguage(next.uiLanguage);
    formRef.current = next;
    setFormState(next);
    // Keep an empty number field editable without persisting an unintended default.
    if (!Number.isFinite(patch.autoReturnToSubtitlesSeconds)) delete patch.autoReturnToSubtitlesSeconds;
    if (!Number.isFinite(patch.historyRetentionDays)) delete patch.historyRetentionDays;
    if (Object.keys(patch).length === 0) return;
    const version = ++revision.current;
    setSaveStatus("正在保存…");
    void persist(patch, version);
  }

  async function persist(patch: Partial<ExtensionSettings>, version = ++revision.current) {
    setSaveStatus("正在保存…");
    try {
      await autosave.current.save(patch);
      if (version === revision.current) setSaveStatus("所有更改已保存");
    } catch {
      if (version === revision.current) setSaveStatus("保存失败，请重试");
    }
  }

  function normalizeField(event: FocusEvent<HTMLFormElement>) {
    if (event.target.id === "auto-return-subtitles") {
      setForm((current) => ({ ...current, autoReturnToSubtitlesSeconds: normalizeAutoReturnSeconds(current.autoReturnToSubtitlesSeconds) }));
    } else if (event.target.id === "history-limit") {
      setForm((current) => ({ ...current, historyRetentionDays: normalizeHistoryDays(current.historyRetentionDays) }));
    } else if (event.target.id === "ms-endpoint" || event.target.id === "llm-base") {
      const key = event.target.id === "ms-endpoint" ? "microsoftTranslatorEndpoint" : "llmBaseUrl";
      setForm((current) => ({ ...current, [key]: current[key].trim().replace(/\/+$/, "") }));
    }
  }

  async function testProvider(provider: TranslationProvider | "llm") {
    setProviderMessage("正在测试连接…");
    try {
      if (!await requestApiPermissions(form, provider)) throw new Error("需要先允许访问所配置的 API 域名");
      await autosave.current.settled();
      await autosave.current.save({});
      if (provider === "chrome-local") await translateInChrome("This is a connection test.", "en", form.targetLanguage, undefined, loaded => setProviderMessage(t("语言包下载进度：{0}%", Math.round(loaded * 100))));
      else await sendMessage({ type: "TEST_PROVIDER", provider });
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
      setForm((current) => ({ ...current,
        offlineDictionary: dictionaryMetadata,
        offlineDictionaryCss: cssMetadata,
        offlineDictionaryResources: resourceMetadata,
        offlineDictionaryDirectory: { name: directoryName, lastImported: Date.now() }
      }));
      setDictionaryMessage(`词典已导入。MDX：${mdx.name}；CSS：${css?.name || "N/A"}；MDD：${mddFiles.length}`);
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
      setForm((current) => ({ ...current,
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

  const category = categories.find((item) => item.id === activeCategory)!;
  if (!loaded) return <main className="loading" role="status">{t("正在加载设置…")}</main>;
  return (
    <div className="settings-shell">
      <aside className="sidebar" aria-label={t("设置导航")}>
        <div className="brand"><img className="brand-mark" src="icons/logo.svg" alt="" width="26" height="26" /><span>Tubitle <span className="brand-label">{t("设置")}</span></span></div>
        <nav aria-label={t("设置分类")}>
          {categories.map((item) => <div key={item.id}>
            <button type="button" className={`nav-item ${activeCategory === item.id ? "is-active" : ""}`} aria-current={activeCategory === item.id ? "page" : undefined} aria-expanded={"children" in item ? activeCategory === item.id : undefined} onClick={() => setActiveCategory(item.id)}>
              <CategoryIcon name={item.icon} /><span>{t(item.label)}</span>
              {"children" in item && <span className="chevron" aria-hidden="true">{activeCategory === item.id ? "⌄" : "›"}</span>}
            </button>
            {"children" in item && activeCategory === item.id && <div className="nav-children">
              {item.children.map((child) => <a key={child.id} href={`#${child.id}`}>{t(child.label)}</a>)}
            </div>}
          </div>)}
        </nav>
        <div className="sidebar-footer">Tubitle<span>{t("浏览器扩展")}</span></div>
      </aside>
      <main className="page">
        <header className="page-header"><div><h1>{t("{0}设置", t(category.label))}</h1><p className="lead">{t(category.description)}</p></div><span className={`save-status ${saveStatus.includes("失败") ? "is-error" : ""}`} role="status">{t(saveStatus)}{saveStatus.includes("失败") && <button type="button" className="retry-save" onClick={() => void persist({})}>{t("重试")}</button>}</span></header>
        <form onSubmit={(event) => event.preventDefault()} onBlur={normalizeField}>
        <div hidden={activeCategory !== "services"}>
        <section className="card">
          <h2>{t("服务方式")}</h2>
          <div className="field">
            <label htmlFor="service-mode">{t("字幕翻译")}</label>
            <select id="service-mode" value={form.serviceMode} onChange={(event) => {
              const mode = event.target.value === "custom" ? "custom" : "tubitle";
              setForm({ ...form, serviceMode: mode, provider: translationProvider(mode, form.provider) });
              setProviderMessage("");
            }}>
              <option value="tubitle">{t("使用 Tubitle 服务（默认）")}</option>
              <option value="custom">{t("选择翻译引擎（免 Key / 自备 API）")}</option>
            </select>
          </div>
          <p className="hint">{form.serviceMode === "tubitle"
            ? t("由 Tubitle 提供字幕翻译，受账号套餐额度限制。")
            : t("字幕直接交给所选翻译引擎，不消耗 Tubitle 翻译额度。")}</p>
        </section>
        {form.serviceMode === "custom" && <>
        <section className="card">
          <h2>{t("字幕翻译 API")}</h2>
          <div className="field">
            <label htmlFor="provider">{t("翻译服务商")}</label>
            <select id="provider" value={form.provider} onChange={(event) => { setForm({ ...form, provider: event.target.value as TranslationProvider }); setProviderMessage(""); }}>
              <optgroup label={t("免 Key 翻译")} >{KEYLESS_PROVIDERS.map(([id, name]) => <option value={id} key={id}>{name}{["baidu-free", "deepl-free"].includes(id) ? ` (${t("实验入口")})` : ""}</option>)}</optgroup>
              <optgroup label={t("自备 API Key")}><option value="microsoft">Microsoft Translator</option>
              <option value="google">Google Cloud Translation</option></optgroup>
            </select>
          </div>
          {isKeylessProvider(form.provider) ? <>
          <p className="hint">{form.provider === "chrome-local" ? t("翻译在本机运行。需桌面 Chrome 138 或更新版本；首次使用需要点击测试并下载语言包，视频页面也可能需要点击播放以完成初始化。") : t("无需填写 Key，字幕会发送到所选服务。服务可能限流或变更；不可用时请切换引擎。点击测试可授予该服务域名的访问权限。")}</p>
          {["baidu-free", "deepl-free"].includes(form.provider) && <p className="hint">{t("实验入口：当前实测受到服务方限制，测试失败时请使用其他引擎。")}</p>}
          <div className="actions"><button className="secondary" type="button" onClick={() => void testProvider(form.provider)}>{t("测试翻译引擎")}</button></div>
          </> : form.provider === "microsoft" ? <>
          <h3>Microsoft Translator</h3>
          <div className="grid">
            <div className="field"><label htmlFor="ms-key">Subscription Key</label><input id="ms-key" type="password" value={form.microsoftTranslatorKey} onChange={(event) => setForm({ ...form, microsoftTranslatorKey: event.target.value })} autoComplete="off" /></div>
            <div className="field"><label htmlFor="ms-region">Region</label><input id="ms-region" value={form.microsoftTranslatorRegion} onChange={(event) => setForm({ ...form, microsoftTranslatorRegion: event.target.value })} /></div>
            <div className="field full"><label htmlFor="ms-endpoint">Endpoint</label><input id="ms-endpoint" type="url" value={form.microsoftTranslatorEndpoint} onChange={(event) => setForm({ ...form, microsoftTranslatorEndpoint: event.target.value })} /></div>
          </div>
          <div className="actions"><button className="secondary" type="button" onClick={() => void testProvider("microsoft")}>{t("测试 Microsoft")}</button></div>
          </> : <>
          <h3>Google Cloud Translation</h3>
          <div className="grid"><div className="field full"><label htmlFor="google-key">API Key</label><input id="google-key" type="password" value={form.googleTranslateApiKey} onChange={(event) => setForm({ ...form, googleTranslateApiKey: event.target.value })} autoComplete="off" /></div></div>
          <div className="actions"><button className="secondary" type="button" onClick={() => void testProvider("google")}>{t("测试 Google")}</button></div>
          </>}
        </section>
        </>}
        <section className="card">
          <h2>{t("AI 语句分析 API")}</h2>
          <div className="field"><label htmlFor="analysis-service-mode">{t("AI 语句分析服务")}</label>
          <select id="analysis-service-mode" value={form.analysisServiceMode} onChange={event => setForm({ ...form, analysisServiceMode: event.target.value === "custom" ? "custom" : "tubitle" })}>
            <option value="tubitle">{t("Tubitle 服务（有配额限制）")}</option>
            <option value="custom">{t("自己的大模型 API（不受 Tubitle 配额限制）")}</option>
          </select></div>
          {form.analysisServiceMode === "tubitle" ? <p className="hint">{t("AI 解析需登录，免费版每天 3 次，Pro 每天 100 次。")}</p> : <>
          <p className="hint">{t("不消耗 Tubitle 额度，费用与使用限额由你的 API 提供方决定。")}</p>
          <p className="hint">{t("填写 OpenAI 兼容接口的地址、API Key 和模型名称。无需登录 Tubitle 即可使用自备 API 解析句子。")}</p>
          <div className="grid">
            <div className="field full"><label htmlFor="llm-base">API Base URL</label><input id="llm-base" type="url" value={form.llmBaseUrl} onChange={(event) => setForm({ ...form, llmBaseUrl: event.target.value })} /></div>
            <div className="field"><label htmlFor="llm-key">API Key</label><input id="llm-key" type="password" value={form.llmApiKey} onChange={(event) => setForm({ ...form, llmApiKey: event.target.value })} autoComplete="off" /></div>
            <div className="field"><label htmlFor="llm-model">Model</label><input id="llm-model" value={form.llmModel} onChange={(event) => setForm({ ...form, llmModel: event.target.value })} /></div>
          </div>
          <div className="actions"><button className="secondary" type="button" onClick={() => void testProvider("llm")}>{t("测试大模型")}</button></div>
        </>}
        </section>
        {(form.serviceMode === "custom" || form.analysisServiceMode === "custom") && <div className="permission-note"><p className="hint">{t("设置会自动保存。首次使用自定义 API 域名时，需要允许浏览器访问该域名。")}</p><button className="secondary" type="button" onClick={() => void requestApiPermissions(form).then((allowed) => setProviderMessage(allowed ? "已允许访问 API 域名" : "未获得 API 域名访问权限")).catch((error: Error) => setProviderMessage(error.message))}>{t("允许访问 API 域名")}</button></div>}
        {providerMessage && <p className="hint" role="status">{t(providerMessage)}</p>}
        </div>
        <div hidden={activeCategory !== "subtitles"}>
        <section className="card">
          <h2 id="language">{t("翻译语言")}</h2>
          <div className="field"><label htmlFor="target-language">{t("目标语言")}</label>
            <select id="target-language" value={form.targetLanguage} onChange={(event) => setForm({ ...form, targetLanguage: event.target.value })}>
              {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{languageName(code)}</option>)}
            </select>
          </div>
          <fieldset><legend>{t("不需要翻译的语言（多选）")}</legend><div className="grid">
            {LANGUAGES.filter(([code]) => code !== "zh-TW").map(([code, label]) => <label key={code}>
              <input type="checkbox" checked={form.excludedLanguages.includes(code)} onChange={(event) => setForm({ ...form, excludedLanguages: event.target.checked ? [...form.excludedLanguages, code] : form.excludedLanguages.filter((item) => item !== code) })} /> {code === "zh" ? t("中文（简体及繁体）") : languageName(code)}
            </label>)}
          </div></fieldset>
          <p className="hint">{t("所选语言及与目标语言相同的字幕只显示原文，不请求翻译。")}</p>
          </section><section className="card"><h2 id="interaction">{t("字幕交互")}</h2>
          <div className="grid">
            <label><input type="checkbox" checked={form.showChinese} onChange={(event) => setForm({ ...form, showChinese: event.target.checked })} />{t("默认显示翻译")}</label>
            <label><input type="checkbox" checked={form.hoverPause} onChange={(event) => setForm({ ...form, hoverPause: event.target.checked })} />{t("悬停字幕时暂停")}</label>
            <label><input type="checkbox" checked={form.resumeAfterHover} onChange={(event) => setForm({ ...form, resumeAfterHover: event.target.checked })} />{t("离开后恢复播放")}</label>
            <div className="field">
              <label htmlFor="auto-return-subtitles">{t("自动返回字幕（秒）")}</label>
              <input id="auto-return-subtitles" type="number" min="0" max={MAX_AUTO_RETURN_SECONDS} step="1" required
                aria-describedby="auto-return-subtitles-hint"
                value={Number.isNaN(form.autoReturnToSubtitlesSeconds) ? "" : form.autoReturnToSubtitlesSeconds}
                onChange={(event) => setForm({ ...form, autoReturnToSubtitlesSeconds: event.target.valueAsNumber })} />
              <span className="hint" id="auto-return-subtitles-hint">{t("仅在视频正常播放时计时。默认 10 秒，填 0 关闭。")}</span>
            </div>
          </div>
        </section>
        <section className="card">
          <h2 id="appearance">{t("字幕样式")}</h2>
          <div className="grid">
            <div className="field">
              <label htmlFor="english-size">{t("原文字号：")}{form.subtitleAppearance.englishFontSize}px</label>
              <input id="english-size" type="range" min="14" max="48" value={form.subtitleAppearance.englishFontSize} onChange={(event) => setForm({ ...form, subtitleAppearance: { ...form.subtitleAppearance, englishFontSize: Number(event.target.value) } })} />
            </div>
            <div className="field">
              <label htmlFor="chinese-size">{t("译文字号：")}{form.subtitleAppearance.chineseFontSize}px</label>
              <input id="chinese-size" type="range" min="12" max="42" value={form.subtitleAppearance.chineseFontSize} onChange={(event) => setForm({ ...form, subtitleAppearance: { ...form.subtitleAppearance, chineseFontSize: Number(event.target.value) } })} />
            </div>
            <div className="field">
              <label htmlFor="english-color">{t("原文颜色")}</label>
              <input id="english-color" type="color" value={form.subtitleAppearance.englishColor} onChange={(event) => setForm({ ...form, subtitleAppearance: { ...form.subtitleAppearance, englishColor: event.target.value } })} />
            </div>
            <div className="field">
              <label htmlFor="chinese-color">{t("译文颜色")}</label>
              <input id="chinese-color" type="color" value={form.subtitleAppearance.chineseColor} onChange={(event) => setForm({ ...form, subtitleAppearance: { ...form.subtitleAppearance, chineseColor: event.target.value } })} />
            </div>
          </div>
          <div className="actions"><button type="button" onClick={() => setForm({ ...form, subtitlePosition: DEFAULT_SETTINGS.subtitlePosition })}>{t("恢复默认字幕位置")}</button></div>
          <p className="hint">{t("字幕默认位于播放器中下方。播放时也可以从字幕框的空白处拖动，位置会自动保存。")}</p>
        </section>
        </div><div hidden={activeCategory !== "dictionary"}>
        <section className="card">
          <h2>{t("离线词典")}</h2>
          <input ref={dictionaryDirectoryInput} hidden multiple type="file" {...({ webkitdirectory: "" } as { webkitdirectory: string })} onChange={(event) => void chooseDictionaryDirectory(event)} />
          {form.offlineDictionary.configured ? (
            <div>
              <p><strong>{form.offlineDictionaryDirectory.name || t("已导入的词典目录")}</strong></p>
              <p className="hint">MDX：{form.offlineDictionary.name}（{formatFileSize(form.offlineDictionary.size)}）</p>
              <p className="hint">CSS：{form.offlineDictionaryCss.configured ? `${form.offlineDictionaryCss.name}（${formatFileSize(form.offlineDictionaryCss.size)}）` : t("未找到")}</p>
              <p className="hint">MDD：{form.offlineDictionaryResources.configured
                ? form.offlineDictionaryResources.files.map((file) => `${file.name}（${formatFileSize(file.size)}）`).join("、")
                : t("未找到")}</p>
              <p className="hint">{t("目录内的匹配文件已复制到浏览器扩展存储，不会上传到服务。")}</p>
            </div>
          ) : <p className="hint">{t("选择包含 MDX、CSS 和 MDD 的词典目录，扩展会自动识别并导入。未设置时，查词页会隐藏离线词典。")}</p>}
          <div className="actions">
            <button type="button" disabled={dictionaryBusy} onClick={() => dictionaryDirectoryInput.current?.click()}>{form.offlineDictionary.configured ? t("重新选择词典目录") : t("选择词典目录")}</button>
            {form.offlineDictionary.configured && <button type="button" disabled={dictionaryBusy} onClick={() => void removeDictionary()}>{t("移除离线词典")}</button>}
          </div>
          {dictionaryMessage && <p className="hint">{t(dictionaryMessage)}</p>}
        </section>
        </div><div hidden={activeCategory !== "general"}>
        <section className="card"><h2>Language</h2><div className="field"><label htmlFor="ui-language">{t("界面语言")}</label><select id="ui-language" value={form.uiLanguage} onChange={(event) => setForm({ ...form, uiLanguage: event.target.value as ExtensionSettings["uiLanguage"] })}>
          {UI_LANGUAGES.map(([code, name]) => <option lang={code} dir="auto" key={code} value={code}>{name}</option>)}
        </select><p className="hint">{t("选择插件界面的显示语言，不会改变字幕翻译的目标语言。")}</p></div></section>
        <section className="card">
          <h2>{t("学习面板历史")}</h2>
          <div className="grid">
            <div className="field">
              <label htmlFor="history-limit">{t("最多保存天数")}</label>
              <input id="history-limit" type="number" min="1" max="365" value={Number.isNaN(form.historyRetentionDays) ? "" : form.historyRetentionDays} onChange={(event) => setForm({ ...form, historyRetentionDays: event.target.valueAsNumber })} />
              <span className="hint">{t("按本地日期保留最近 1–365 天（含今天）的查词、翻译和分析记录，默认 30 天。过期记录自动清理；不影响已上传的网页记录。")}</span>
            </div>
          </div>
        </section>
        <section className="card"><h2>{t("关于 Tubitle")}</h2><p className="hint">{t("默认使用 Tubitle 服务，无需填写 API Key。自备 API 的密钥仅保存在本机浏览器，不会上传到 Tubitle。")}</p><p className="hint">{t("所有设置自动保存，并立即应用到已打开的学习面板与字幕。")}</p></section>
        </div><div hidden={activeCategory !== "shortcuts"}>
        <section className="card">
          <h2>{t("快捷键")}</h2>
          <div className="grid">
            {(Object.keys(shortcutLabels) as Array<keyof ShortcutSettings>).map((name) => (
              <div className="field" key={name}>
                <label htmlFor={`shortcut-${name}`}>{t(shortcutLabels[name])}</label>
                <input id={`shortcut-${name}`} value={form.shortcuts[name]} onChange={(event) => setShortcut(name, event.target.value)} placeholder="Alt+R" />
              </div>
            ))}
          </div>
          <p className="hint">{t("格式示例：Alt+ArrowLeft、Alt+R、Ctrl+Shift+A。若与系统或浏览器快捷键冲突，请在此修改。")}</p>
        </section>
        </div>
        </form>
      </main>
    </div>
  );
}

if (typeof document !== "undefined") {
  initializeI18n(true);
  createRoot(document.getElementById("root")!).render(<App />);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
