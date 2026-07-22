import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";
import {
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_OTHER_BYTES,
  SERVER_ACTION_BODY_SIZE_LIMIT,
  SERVER_ACTION_BODY_SIZE_LIMIT_BYTES,
  SERVER_ACTION_BODY_SIZE_LIMIT_MIB,
} from "@/lib/structured-editor-upload-limits";

describe("structured editor upload limits", () => {
  it("configures Server Actions above the documented 250 MiB audio maximum", () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe(SERVER_ACTION_BODY_SIZE_LIMIT);
    expect(SERVER_ACTION_BODY_SIZE_LIMIT).toBe(`${SERVER_ACTION_BODY_SIZE_LIMIT_MIB}mb`);
    expect(SERVER_ACTION_BODY_SIZE_LIMIT_BYTES).toBeGreaterThan(MAX_AUDIO_BYTES);
    expect(SERVER_ACTION_BODY_SIZE_LIMIT_BYTES - MAX_AUDIO_BYTES).toBeGreaterThanOrEqual(10 * 1024 * 1024);
  });

  it("keeps audio as the largest bounded editor upload class", () => {
    expect(MAX_AUDIO_BYTES).toBe(250 * 1024 * 1024);
    expect(MAX_AUDIO_BYTES).toBeGreaterThan(MAX_OTHER_BYTES);
    expect(MAX_OTHER_BYTES).toBeGreaterThan(MAX_IMAGE_BYTES);
  });
});
