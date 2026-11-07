import q4 from './hy-mt2/q4/model.mjs';
import twoBit from './hy-mt2/2bit/model.mjs';
import opus from './opus/model.mjs';

export const models = new Map([['q4', q4], ['2bit', twoBit], ['opus', opus]]);
export const defaultModel = 'q4';
export const modelIds = new Map([...models.values()].map(model => [model.id, model]));
export const knownTargets = new Set([...models.values()].flatMap(model => model.targets));
