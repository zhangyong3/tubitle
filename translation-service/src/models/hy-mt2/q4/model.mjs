import { fileURLToPath } from 'node:url';
import { createLlamaModel } from '../../llama/adapter.mjs';

export default createLlamaModel({
  name: 'q4',
  id: 'hy-mt2-1.8b-q4',
  weight: 'models/Hy-MT2-1.8B-Q4_K_M.gguf',
  setupScript: fileURLToPath(new URL('./setup.sh', import.meta.url)),
});
