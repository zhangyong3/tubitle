export class InferenceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function requestInference(url, payload, signal, { forwardBadRequest = false } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (response.ok) return response.json();
  if (forwardBadRequest && response.status === 400) {
    throw new InferenceError(400, (await response.json()).error);
  }
  await response.body?.cancel();
  throw new InferenceError(response.status === 503 ? 503 : 502, `Inference returned HTTP ${response.status}`);
}
