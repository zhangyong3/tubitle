import { fileURLToPath } from 'node:url';
import { createLlamaModel } from '../../llama/adapter.mjs';

export default createLlamaModel({
  name: '2bit',
  id: 'hy-mt2-1.8b-2bit',
  weight: 'models/Hy-MT2-1.8B-2Bit.gguf',
  setupScript: fileURLToPath(new URL('./setup.sh', import.meta.url)),
  runtime: () => ({
    LLAMA_SERVER: process.env.TUBITLE_2BIT_SERVER ?? './.runtime/q2-src/legacy/build/bin/llama-server',
    LLAMA_GPU_LAYERS: '0',
  }),
});
