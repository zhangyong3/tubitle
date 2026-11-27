# Google 账号登录配置记录

更新日期：2026-11-27

## 云端注册

- Google Cloud 项目：`tubitle`
- 项目编号：`248459594616`
- 应用名称：`Tubitle`
- 用户支持邮箱及开发者联系邮箱：`zhangyong309@gmail.com`
- 受众：外部，初始为测试模式。
- 当前状态：OAuth 配置与 Web OAuth 客户端均已创建，客户端状态为已启用。
- 客户端名称：`Tubitle Web Local`，类型：Web 应用。
- Client ID：`248459594616-kpgle4ojjokptbboebekk5835ptmae97.apps.googleusercontent.com`
- 创建时间：2026-11-27 10:58:52（Asia/Shanghai）。
- 凭据保存在 `web/data/google-oauth-client.local.json`，文件权限 `0600`，已确认被 Git 忽略；包含 Client Secret，请勿分享或提交。
- 控制台：https://console.cloud.google.com/auth/overview?project=tubitle

## 项目接入

项目已具备 Better Auth 的 Google provider 和登录按钮，通过后台 Settings 配置：

- `google_auth_enabled`：`true`
- `google_client_id`：填写上面的 Client ID。
- `google_client_secret`：从本地凭据文件读取并保存至后台配置，勿写入本文档或提交到 Git。
- `google_one_tap_enabled`：可选，本次无需启用。

本地 `.env.development` 的应用地址为 `http://127.0.0.1:3100`。
已创建 Web 应用 OAuth 客户端，授权 JavaScript 来源为该地址，授权重定向 URI 为：

```text
http://127.0.0.1:3100/api/auth/callback/google
```

本机测试应使用上述地址，`localhost` 与 `127.0.0.1` 不可直接混用。其他设备不能通过它访问本机项目。生产域名尚未确认；部署上线时按实际 `AUTH_URL`（默认 `VITE_APP_URL`）增加对应来源和 `/api/auth/callback/google` 回调。

## 待完成

1. 应用初始化已完成。
2. Web OAuth 客户端创建及凭据本地保存已完成。
3. 配置项目后台，核对测试用户或发布状态。创建结果提示目前仅测试用户可访问。
4. 实测 Google 登录、回调及用户会话。
