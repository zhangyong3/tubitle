# VPS 部署与运维

当前实例：`root@64.177.59.175`，安装目录 `/opt/tubitle-translation`，公网地址 **https://translate.yzdev.de5.net**。当前小牛 `niutrans`，已安装备选混元 `q4`。见 [实测报告](../results/vps-deployment.md)。

## 插件连接

1. Chrome 扩展管理页重新加载本项目已构建的 `extension/dist`。
2. 打开 Tubitle 设置，选择「使用 Tubitle 自研翻译服务」。
3. 服务地址填 `https://translate.yzdev.de5.net`，不加 `/v1`。
4. 访问密钥填本机 `.runtime/vps-access.json` 的 `tubitleApiKey`，或登录 VPS 读取 `/etc/tubitle-translation-access.json`。文件不提交 Git。
5. 点击「测试 Tubitle 翻译服务」，允许访问域名；连接成功后保存，刷新视频页。

默认保留本机地址 `http://127.0.0.1:18081`，可以继续连接本地服务。远程密钥只保存在 Chrome storage.local，不写入源码和构建产物。缓存按服务地址、模型隔离。

## 启停、切换与日志

登录 VPS 后：

```sh
tubitle-service status
tubitle-service health
tubitle-service restart
tubitle-service stop
tubitle-service start
tubitle-service model q4
tubitle-service model niutrans
tubitle-service logs
```

VPS 由 systemd 管理，避免同时用 `service.sh start` 再启动一份服务。`service.sh run <模型>` 是 systemd 使用的前台模式。

配置在 `/etc/tubitle-translation.env`：

```ini
TUBITLE_MODEL=niutrans
TUBITLE_PORT=18081
TUBITLE_BACKEND_PORT=18080
LLAMA_THREADS=4
LLAMA_PARALLEL=4
LLAMA_CTX=8192
LLAMA_GPU_LAYERS=0
```

修改后执行 `tubitle-service restart`。两种已部署模型只同时运行一个。

## 健康检查、恢复与证书

```sh
curl -fsS https://translate.yzdev.de5.net/health
systemctl status tubitle-translation
systemctl list-timers --all | grep -E 'tubitle|certbot'
journalctl -u tubitle-translation -u tubitle-translation-health -n 100 --no-pager
journalctl -u nginx -u certbot -n 100 --no-pager
```

进程异常退出后 systemd 等待约 5 秒重启；每分钟请求内部 `/health`，连续三次失败触发重启。手动停止后检查会跳过，不会拉起。频繁失败触发启动频率上限时，排查原因后执行 `systemctl reset-failed tubitle-translation` 再启动。

Certbot 定时续期，成功后 reload Nginx；首次证书有效至 2027-02-14。尚未接邮件/微信等外部告警。外部监控可 GET 公共 `/health`，要求 HTTP 200、ready=true；仅在 VPS 内的检查无法发现整机断网。

代理配置在 `/etc/nginx/sites-available/tubitle-translation`，密钥配置在 `/etc/nginx/conf.d/tubitle-auth.conf`（root 0600）。`/v1/translate` 要求 Bearer 密钥；`/health` 无需密钥。当前全局 10 请求/秒、每 IP 5 请求/秒、burst 8、同时处理最多 8 请求，超限返回 429。保护上限不代表模型能持续处理 10 请求/秒。

## 复跑压测

在 VPS 的 `/opt/tubitle-translation` 运行，期间避免其他翻译流量：

```sh
BENCH_ROUNDS=4 BENCH_BACKEND=vps-cpu node benchmarks/bench.mjs results/vps-current.json
BENCH_DURATION_SECONDS=60 BENCH_CONCURRENCY=4 \
  BENCH_CGROUP=/sys/fs/cgroup/system.slice/tubitle-translation.service \
  node benchmarks/stress.mjs results/vps-stress.json
```

结果包含译文、完成数、吞吐和延迟；持续测试另采集服务 cgroup CPU、内存，基本用满 CPU。loopback 压测用于隔离公网网络影响。

## 安装脚本与更新

`install-systemd.sh` 要求 root、固定目录 `/opt/tubitle-translation`、已有 `.runtime/llama-server` 与小牛权重。创建专用 `tubitle` 用户并安装 unit；源代码和权重保持只读，运行目录和 results 可写。内存软阈值 5G、硬上限 6G。

`install-https.sh <域名>` 要求已安装 Nginx、Python 3、Certbot，并已获得该域名的 `/etc/letsencrypt/live/<域名>/fullchain.pem`。首次生成访问密钥；重复执行保留密钥，重建代理配置，启用续期与 reload hook。域名 A 应指向 VPS，UFW/云防火墙需允许 80/443。

本实例已完成安装。后续复制代码时排除 `.runtime/`、`models/` 和私有连接文件，保留服务器访问密钥；执行 `tubitle-service restart` 后检查健康接口。
