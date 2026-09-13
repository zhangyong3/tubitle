import type { ExtensionMessage, MessageResponse } from "./types";

export async function sendMessage<T>(message: ExtensionMessage): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as MessageResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error || "扩展后台没有响应");
  }
  return response.data;
}
