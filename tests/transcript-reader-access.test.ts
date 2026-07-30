import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { nextTranscriptTabStop, TranscriptReader } from "@/components/transcript-reader";

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
  it("renders one roving transcript tab stop with an action-and-time label", () => {
    const markup = renderToStaticMarkup(createElement(TranscriptReader, {
      audioUrl: "/media/episodes/episode-1",
      canEditTranscript: false,
      segments: [
        segments[0],
        { ...segments[0], segmentId: "segment-2", segmentIndex: 1, startSeconds: 5, endSeconds: 10, text: "Bear much fruit." },
        { ...segments[0], segmentId: "segment-3", segmentIndex: 2, startSeconds: null, endSeconds: null, text: "Untimed note." },
      ],
      trackId: "episode-1",
    }));

    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Seek to 0 seconds, transcript segment 1 of 2: Abide in me."');
    expect(markup).toContain('role="group" aria-label="Transcript seek controls"');
  });

  it("moves the roving tab stop with arrows, Home, and End", () => {
    const indexes = [2, 7, 11];
    expect(nextTranscriptTabStop(7, indexes, "ArrowRight")).toBe(11);
    expect(nextTranscriptTabStop(7, indexes, "ArrowDown")).toBe(11);
    expect(nextTranscriptTabStop(7, indexes, "ArrowLeft")).toBe(2);
    expect(nextTranscriptTabStop(7, indexes, "ArrowUp")).toBe(2);
    expect(nextTranscriptTabStop(7, indexes, "Home")).toBe(2);
    expect(nextTranscriptTabStop(7, indexes, "End")).toBe(11);
    expect(nextTranscriptTabStop(7, indexes, "Enter")).toBeNull();
  });

  it("renders the editor entry point only when the server grants mutation permission", () => {
    expect(transcriptMarkup(true)).toContain("Edit transcript");
    expect(transcriptMarkup(false)).not.toContain("Edit transcript");
    expect(transcriptMarkup(false)).not.toContain("Save correction");
  });

  it("renders Administrator controls after audio controls and before the transcript", () => {
    const markup = renderToStaticMarkup(
      createElement(TranscriptReader, {
        audioUrl: "/media/episodes/episode-1",
        canEditTranscript: true,
        controlsAfter: createElement("aside", { "data-reprocess-panel": true }, "Reprocess this episode"),
        segments,
        trackId: "episode-1",
      }),
    );

    expect(markup.indexOf("transcript-reader__bar")).toBeLessThan(markup.indexOf("data-reprocess-panel"));
    expect(markup.indexOf("data-reprocess-panel")).toBeLessThan(markup.indexOf("transcript-reader__layout"));
  });

  it("keeps audio and Administrator controls visible when no transcript exists", () => {
    const markup = renderToStaticMarkup(createElement(TranscriptReader, {
      audioUrl: "/media/episodes/episode-1",
      canEditTranscript: true,
      controlsAfter: createElement("aside", null, "Reprocess this episode"),
      segments: [],
      trackId: "episode-1",
    }));
    expect(markup).toContain("<audio");
    expect(markup).toContain("Reprocess this episode");
  });

  it("derives the permission on the protected episode page from the authorized app role", async () => {
    const page = await readFile(new URL("../app/(private)/console/episodes/[trackId]/page.tsx", import.meta.url), "utf8");

    expect(page).toContain("requireInternalReadConsoleUser()");
    expect(page).toContain("canEditTranscript={canMutateForRole(appUser.role)}");
    expect(page).toContain('const isAdministrator = appUser.role === "Admin"');
    expect(page).toContain("controlsAfter={isAdministrator ? (");
    expect(page).toContain('name="confirmReprocess"');
  });
});
