# Tubitle

Tubitle 是一个个人自托管的 YouTube 英语学习工具，由 **Next.js API + Chrome/Edge Manifest V3 扩展**组成。服务端可直接部署到 Vercel.

## 功能

- 英文、中文双行字幕，自动优先选择英文人工字幕
- 使用视频官方中文字幕，或调用 Microsoft、Google Cloud、腾讯云翻译
- 上一句、下一句、重复当前句与自定义快捷键
- 字幕位置、字号、颜色及悬停暂停
- 离线 MDX/MDD 词典、发音、查词历史
- 通过 OpenAI Chat Completions 兼容接口流式解析句子
- 个人访问令牌保护 API，服务商密钥只保存在服务端

## 项目结构

```text
app/             Next.js 页面与 Route Handlers
lib/server/      服务端鉴权、缓存、翻译及 LLM 实现
extension/  TypeScript + React 浏览器扩展
scripts/         扩展构建脚本
```

## 本地开发

要求 Node.js 20.9 或更高版本。

```bash
npm install
cp .env.example .env.local
npm run dev
```

编辑 `.env.local`，至少填写：

- `PERSONAL_ACCESS_TOKEN`：自定义长随机字符串
- 一种翻译服务的密钥
- 使用语句解析时填写 `LLM_API_KEY`，并按需修改 `LLM_BASE_URL` 和 `LLM_MODEL`

浏览器打开 `http://localhost:3000/api/health` 可查看各项是否已配置；接口只返回布尔状态，不会暴露密钥。

## 构建扩展

```bash
npm run build:extension
```

打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，加载 `extension/dist`。然后打开扩展设置：

1. 服务地址填写 `http://localhost:3000` 或 Vercel 生产地址。
2. 个人访问令牌填写与 `PERSONAL_ACCESS_TOKEN` 完全相同的值。
3. 选择已在服务端配置的默认翻译引擎并保存。

扩展会在保存服务地址时请求访问该域名，不会在安装时申请全部网站权限。

## 部署到 Vercel

1. 将仓库推送到 Git 服务，在 Vercel 中导入仓库。
2. Framework Preset 选择 Next.js，Root Directory 保持仓库根目录。
3. 在 Environment Variables 中复制 `.env.example` 所需变量。
4. 部署后访问 `https://你的域名/api/health` 检查配置。
5. 在扩展设置中填写 Vercel 地址与 `PERSONAL_ACCESS_TOKEN`。

建议先加载扩展，再从 `chrome://extensions` 复制扩展 ID，配置到 `ALLOWED_EXTENSION_IDS`。未配置该变量时接受任意 `chrome-extension://` 来源，但每个业务 API 仍必须提供正确的个人访问令牌。

Vercel 的无服务器实例可能随时重建，因此内存缓存只是性能优化，不用于保存账号或用量。此个人版没有持久化服务端数据。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `PERSONAL_ACCESS_TOKEN` | 必填；保护翻译和 LLM API |
| `ALLOWED_EXTENSION_IDS` | 可选；限制允许跨域访问的扩展 ID |
| `MICROSOFT_TRANSLATOR_KEY` | Microsoft Translator 密钥 |
| `MICROSOFT_TRANSLATOR_REGION` | Microsoft Translator 区域 |
| `GOOGLE_TRANSLATE_API_KEY` | Google Cloud Translation Basic v2 密钥 |
| `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` | 腾讯云机器翻译凭证 |
| `TENCENT_REGION` | 腾讯云区域，默认 `ap-guangzhou` |
| `LLM_BASE_URL` | OpenAI 兼容 API 根地址 |
| `LLM_API_KEY` | 大模型 API 密钥 |
| `LLM_MODEL` | 模型名称，默认 `gpt-4.1-mini` |

## 验证

```bash
npm run typecheck
npm test
npm run build
npm run build:extension
```

## 默认快捷键

| 操作 | 快捷键 |
| --- | --- |
| 上一句 | `Alt+ArrowLeft` |
| 下一句 | `Alt+ArrowRight` |
| 重复当前句 | `Alt+R` |
| 显示/隐藏中文 | `Alt+T` |
| 解析当前句 | `Alt+A` |

快捷键可在扩展设置中修改。
