import { fileURLToPath } from 'node:url';
import { createHyMt2Model } from '../adapter.mjs';

export default createHyMt2Model({
  name: 'q4',
  id: 'hy-mt2-1.8b-q4',
  weight: 'models/Hy-MT2-1.8B-Q4_K_M.gguf',
  setupScript: fileURLToPath(new URL('./setup.sh', import.meta.url)),
});
