const features = [
  "英中双语字幕与逐句跳转",
  "Microsoft、Google 或腾讯云翻译",
  "OpenAI 兼容接口的流式语句解析",
  "本地 MDX/MDD 词典与学习历史"
];

const steps = [
  "在 Vercel 导入此仓库",
  "配置个人访问令牌与所需 API 密钥",
  "构建并加载浏览器扩展",
  "在扩展设置中填入 Vercel 地址和相同令牌"
];

export default function Home() {
  return (
    <main>
      <nav>
        <a className="brand" href="/">Tubitle</a>
        <a className="status" href="/api/health">API 状态</a>
      </nav>
      <section className="hero">
        <p className="eyebrow">PERSONAL · SELF-HOSTED</p>
        <h1>把 YouTube 字幕<br />变成你的英语学习界面</h1>
        <p className="intro">没有账号、会员和订阅。你的扩展连接到自己的 Vercel 服务，第三方密钥始终留在服务端环境变量中。</p>
        <div className="actions">
          <a className="primary" href="https://vercel.com/new" rel="noreferrer">部署到 Vercel</a>
          <a className="secondary" href="/api/health">检查服务状态</a>
        </div>
      </section>
      <section className="content-grid">
        <article>
          <span className="number">01</span>
          <h2>保留的能力</h2>
          <ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
        </article>
        <article>
          <span className="number">02</span>
          <h2>开始使用</h2>
          <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
        </article>
      </section>
      <footer>私人部署 · 费用仅来自你选择的 API 服务商</footer>
    </main>
  );
}
