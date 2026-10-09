import { describe, expect, it } from "vitest";
import { decodeTextEntities } from "./text-entities";
import { cuesToSentences } from "../content/captions";

describe("subtitle entity decoding", () => {
  it("decodes quotes and apostrophes from the reported subtitles", () => {
    expect(decodeTextEntities('And &quot;No, don&#39;t do it, Mom.&quot;')).toBe('And "No, don\'t do it, Mom."');
  });
  it("handles numeric, hexadecimal, named and double escaped entities", () => {
    expect(decodeTextEntities('&amp;quot;It&amp;#39;s&#x21; &ldquo;OK&rdquo;&nbsp;&#128512;')).toBe('"It\'s! “OK”\u00a0😀');
  });
  it("preserves unknown entities, invalid code points and normal ampersands", () => {
    const text = 'R&D &unknown; &#99999999; &#xD800; &#0;';
    expect(decodeTextEntities(text)).toBe(text);
  });
  it("decodes captions before sentence splitting and display", () => {
    expect(cuesToSentences([{ text: 'It&#39;s a scam. &quot;Hang up.&quot;', startMs: 0, endMs: 3000 }]).map((sentence) => sentence.text))
      .toEqual(["It's a scam.", '"Hang up."']);
  });
  it("returns encoded markup as plain text", () => {
    expect(decodeTextEntities('&lt;img src=x onerror=alert(1)&gt;')).toBe('<img src=x onerror=alert(1)>');
  });
});
