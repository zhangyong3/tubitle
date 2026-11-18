export const TRANSLATION_PROVIDERS = [
  'disabled',
  'selfhosted',
  'siliconflow',
  'aliyun',
  'microsoft',
] as const;
export type TranslationProvider = (typeof TRANSLATION_PROVIDERS)[number];
export type TranslationConfig = Record<string, string>;

export const TRANSLATION_DEFAULTS: TranslationConfig = {
  translation_provider: 'disabled',
  translation_siliconflow_endpoint: 'https://api.siliconflow.cn/v1',
  translation_microsoft_endpoint:
    'https://api.cognitive.microsofttranslator.com',
  translation_aliyun_endpoint: 'https://mt.cn-hangzhou.aliyuncs.com',
};

export function translationConfig(
  values: TranslationConfig
): TranslationConfig {
  return Object.fromEntries(
    Object.entries({ ...TRANSLATION_DEFAULTS, ...values })
      .filter(([key]) => key.startsWith('translation_'))
      .map(([key, value]) => [key, value.trim()])
  );
}

export function translationEndpoint(value: string): URL {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      '翻译服务地址须为 HTTPS，且不能包含账号、密码、查询参数或片段；本机服务可使用 HTTP'
    );
  }
  return url;
}

export function validateTranslationConfig(values: TranslationConfig): void {
  const config = translationConfig(values);
  const provider = config.translation_provider as TranslationProvider;
  if (!TRANSLATION_PROVIDERS.includes(provider))
    throw new Error('不支持的翻译供应商');
  for (const [key, value] of Object.entries(config)) {
    if (key.endsWith('_endpoint') && value) translationEndpoint(value);
  }
  if (provider === 'disabled') return;
  const required: Record<Exclude<TranslationProvider, 'disabled'>, string[]> = {
    selfhosted: ['endpoint'],
    siliconflow: ['endpoint', 'api_key', 'model'],
    aliyun: ['endpoint', 'access_key_id', 'access_key_secret'],
    microsoft: ['endpoint', 'api_key'],
  };
  for (const suffix of required[provider]) {
    const key = `translation_${provider}_${suffix}`;
    if (!config[key]) throw new Error(`请先配置 ${key}`);
  }
  // Aliyun signs the host and root path. Keep endpoints restricted to its official MT hosts.
  const aliyun = translationEndpoint(config.translation_aliyun_endpoint!);
  if (
    !/^mt\.[a-z0-9-]+\.aliyuncs\.com$/.test(aliyun.hostname) ||
    aliyun.protocol !== 'https:' ||
    aliyun.port ||
    aliyun.pathname !== '/'
  ) {
    throw new Error(
      '阿里云地址须为官方机器翻译区域端点，例如 https://mt.cn-hangzhou.aliyuncs.com'
    );
  }
}
