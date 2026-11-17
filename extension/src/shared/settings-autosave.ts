import type { ExtensionSettings } from "./types";

/** Keep edits ordered, and retain failed changes for the next attempt. */
export function createSettingsAutosave(write: (patch: Partial<ExtensionSettings>) => Promise<unknown>) {
  let queue = Promise.resolve();
  let failed: Partial<ExtensionSettings> = {};
  return {
    save(patch: Partial<ExtensionSettings>): Promise<void> {
      const result = queue.then(async () => {
        const pending = { ...failed, ...patch };
        try {
          await write(pending);
          failed = {};
        } catch (error) {
          failed = pending;
          throw error;
        }
      });
      queue = result.catch(() => undefined);
      return result;
    },
    settled: () => queue
  };
}
