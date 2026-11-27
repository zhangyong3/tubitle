# Pro 会员与 Waffo 配置

更新：2026-11-27。

## 已实现

- Pro 商品 ID：`tubitle-pro-monthly`；服务端定价每月 350 美分（USD 3.50），无试用、无优惠码；适用税费由收银台显示。
- 会员中心：`/settings/membership`，显示当前会员、权益及到期时间；支持取消自动续费，权益保留至已付费周期结束。
- Pro 沿用现有服务端权益：AI 解析每天 100 次，学习库不限条数，PDF 下载。免费版每天 2 次 AI、学习库每天新增 5 条/最多 100 条；超额历史不因降级删除。
- 使用 Waffo 官方 `@waffo/pancake-ts` SDK 0.28.0 创建实名关联的收银台，以内部用户 ID 绑定订单，不通过买家填写的邮箱认领会员。
- 后台 Settings → Payment → Waffo Pancake：启用开关、环境、商户 ID、店铺 ID、完整 PEM 签名私钥、Pro 商品 ID、可选验签公钥。
- “测试”按钮只读取商品并核对每月 USD 3.50，不产生订单或扣款。
- 下单始终由服务端固定商品、金额、周期及 Waffo 渠道。未配置或未启用时拒绝下单。
- 回调校验 RSA 签名、45 分钟签名有效期、店铺、环境、用户和订单；查询 Waffo 最新订阅状态后更新本地。重复激活复用现有原子结算，续费沿用交易/周期去重。
- 浏览器成功跳转不作为付款证明；签名回调开通后会员中心每 15 秒刷新状态。
- 关闭 Waffo 启用开关会停止新购买，已保存完整凭据仍用于处理回调及取消订阅。请勿清空凭据，否则无法同步现有订阅。

## 开通后的配置

1. 在 Waffo 开通商户与店铺，先使用 Test 环境。
2. 创建并发布 USD 3.50、monthly 的订阅商品，填入对应环境的商品 ID、Merchant ID、Store ID、私钥。
3. 先配置稳定的 `CONFIG_ENCRYPTION_KEY`，让后台私钥通过现有机制加密落库。未配置该变量时项目原有行为是明文存储；后台响应始终脱敏，公开配置不返回私钥。
4. 点击“测试”检查凭据和商品。测试/正式环境必须使用各自的密钥和商品，切换环境不负责迁移已存在的订阅。
5. 在 Waffo 配置公开 HTTPS 回调：`https://你的域名/api/payment/notify/waffo`。本地 `127.0.0.1` 不能被 Waffo 回调，测试需要 HTTPS 隧道或测试部署。
6. 订阅这些事件：`subscription.activated`、`subscription.renewed`、`subscription.recovered`、`subscription.canceling`、`subscription.uncanceled`、`subscription.canceled`、`subscription.past_due`。
7. 确认测试环境的支付、重复投递、续费、取消及到期降级，再启用正式环境。Waffo 必须通过自己的店铺/域名审核；本次没有执行开通、创建远端商品或真实支付。

## 当前边界

- 未取得 Waffo 商户凭据，远端收银台、GraphQL 字段及真实回调尚未联调；本地测试使用官方 SDK 验签和隔离数据库，远端 API 响应由测试替身提供。
- 当前接入仅售卖 Pro 月度方案；不新增年费、赠送会员或其他商品支付。
- 退款暂通过 Waffo 商户后台处理，并人工核对本地订单和会员期限。本版不实现退款 API 或自动退款对账；收到 `refund.succeeded` 会返回失败以暴露尚需处理的对账，而非静默确认。
- 没有新增数据表，也无需数据库迁移。账单/付款记录页面默认开启，管理员已显式关闭的设置仍被尊重；会员中心可直接取消续费，不依赖账单页开关。

官方参考：[集成说明](https://docs.waffo.ai/zh/features/integrations)、[回调格式与验签](https://docs.waffo.ai/zh/api-reference/webhooks)。
