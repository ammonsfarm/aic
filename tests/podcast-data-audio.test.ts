import { describe, expect, it } from "vitest";

import { buildAudioUrl } from "@/lib/podcast-data";

describe("protected episode reader audio URLs", () => {
  it("serves every canonical operational Track ID through the guarded audio route", () => {
    for (const trackId of ["1003386838", "sa_99151132260", "wp-sermon:14759", "cms_sunday_20260722"]) {
      expect(buildAudioUrl(`${trackId}.mp3`, trackId)).toBe(`/api/audio/${encodeURIComponent(trackId)}`);
    }
  });

  it("does not construct audio routes for malformed or overlong identities", () => {
    for (const trackId of ["../secret", "sa_bad", "9".repeat(101)]) {
      expect(buildAudioUrl(`${trackId}.mp3`, trackId)).toBeNull();
    }
  });
});
