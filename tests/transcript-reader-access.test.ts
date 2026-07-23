import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TranscriptReader } from "@/components/transcript-reader";

const segments = [
  {
    segmentId: "segment-1",
    segmentIndex: 0,
    startSeconds: 0,
    endSeconds: 5,
    speakerName: "Pastor Wood",
    segmentType: "speech",
    text: "Abide in me.",
  },
];

function transcriptMarkup(canEditTranscript: boolean) {
  return renderToStaticMarkup(
    createElement(TranscriptReader, {
      audioUrl: "",
      canEditTranscript,
      segments,
      trackId: "episode-1",
    }),
  );
}

describe("transcript correction controls", () => {
  it("renders the editor entry point only when the server grants mutation permission", () => {
    expect(transcriptMarkup(true)).toContain("Edit transcript");
    expect(transcriptMarkup(false)).not.toContain("Edit transcript");
    expect(transcriptMarkup(false)).not.toContain("Save correction");
  });

  it("derives the permission on the protected episode page from the authorized app role", async () => {
    const page = await readFile(new URL("../app/episodes/[trackId]/page.tsx", import.meta.url), "utf8");

    expect(page).toContain("requireInternalReadConsoleUser()");
    expect(page).toContain("canEditTranscript={canMutateForRole(appUser.role)}");
  });
});
