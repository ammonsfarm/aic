import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { isPublicEpisodeTrackId, parseEpisodeAudioRange, PUBLIC_EPISODE_AUDIO_CACHE_CONTROL, terminateChildOnAbort } from "@/lib/episode-audio";

describe("public episode audio boundary", () => {
  it("does not let intermediaries retain audio after an episode is unpublished", () => {
    expect(PUBLIC_EPISODE_AUDIO_CACHE_CONTROL).toBe("private, no-store");
  });

  it("accepts canonical numeric, SermonAudio, imported sermon, and safe CMS track IDs", () => {
    expect(isPublicEpisodeTrackId("1003386838")).toBe(true);
    expect(isPublicEpisodeTrackId("sa_99151132260")).toBe(true);
    expect(isPublicEpisodeTrackId("wp-sermon:14759")).toBe(true);
    expect(isPublicEpisodeTrackId(decodeURIComponent("wp-sermon%3A14759"))).toBe(true);
    expect(isPublicEpisodeTrackId("cms_sunday_20260722")).toBe(true);
    for (const value of ["../secret", "sa_bad", "cms_../secret", "wp-sermon:bad", "100.mp3", "a/b", ""]) expect(isPublicEpisodeTrackId(value)).toBe(false);
  });

  it("parses bounded single byte ranges", () => {
    expect(parseEpisodeAudioRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19, partial: true });
    expect(parseEpisodeAudioRange("bytes=-10", 100)).toEqual({ start: 90, end: 99, partial: true });
    expect(parseEpisodeAudioRange("bytes=100-101", 100)).toBeNull();
    expect(parseEpisodeAudioRange("bytes=0-1,4-5", 100)).toBeNull();
  });

  it("terminates the mc child when the request aborts and cancels escalation after close", async () => {
    const child = new EventEmitter() as EventEmitter & { kill: (signal: string) => boolean; signals: string[] };
    child.signals = [];
    child.kill = (signal) => { child.signals.push(signal); return true; };
    const controller = new AbortController();
    terminateChildOnAbort(child as never, controller.signal, 10);
    controller.abort();
    expect(child.signals).toEqual(["SIGTERM"]);
    child.emit("close", 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(child.signals).toEqual(["SIGTERM"]);
  });

  it("escalates a child that ignores termination", async () => {
    const child = new EventEmitter() as EventEmitter & { kill: (signal: string) => boolean; signals: string[] };
    child.signals = [];
    child.kill = (signal) => { child.signals.push(signal); return true; };
    const controller = new AbortController();
    terminateChildOnAbort(child as never, controller.signal, 5);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    child.emit("close", 0);
  });
});
