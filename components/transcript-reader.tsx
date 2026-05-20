"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type TranscriptSegment = {
  segmentId: string;
  segmentIndex: number;
  startTime: string;
  endTime: string;
  startSeconds: number | null;
  endSeconds: number | null;
  speakerId: string;
  speakerName: string;
  segmentType: string;
  bibleReferences: unknown[];
  otherReferences: unknown[];
  text: string;
};

type TranscriptReference = {
  referenceId: string;
  segmentIndex: number | null;
  referenceType: string;
  sourceScope: string;
  reference: string;
  startTime: string;
  endTime: string;
  startSeconds: number | null;
  endSeconds: number | null;
  context: string;
  text: string;
  rawReference: unknown;
};

type TranscriptReaderProps = {
  audioUrl: string;
  segments: TranscriptSegment[];
  references: TranscriptReference[];
};

type SegmentGroup = {
  key: string;
  speakerName: string;
  segmentType: string;
  segments: TranscriptSegment[];
};

function referenceLabel(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value && typeof value === "object") {
    const candidate = value as { reference?: unknown; name?: unknown; title?: unknown; text?: unknown };
    for (const key of ["reference", "name", "title", "text"] as const) {
      const item = candidate[key];
      if (typeof item === "string" && item.trim()) {
        return item.trim();
      }
    }
  }

  return "";
}

function typeLabel(value: string) {
  return value.replaceAll("_", " ").trim() || "transcript";
}

function timeLabel(segment: TranscriptSegment) {
  if (segment.startTime && segment.endTime) {
    return `${segment.startTime} to ${segment.endTime}`;
  }

  return segment.startTime || "Time unavailable";
}

function groupSegments(segments: TranscriptSegment[]): SegmentGroup[] {
  const groups: SegmentGroup[] = [];

  for (const segment of segments) {
    const speakerName = segment.speakerName || "Speaker";
    const segmentType = segment.segmentType || "speech";
    const previous = groups.at(-1);

    if (previous && previous.speakerName === speakerName && previous.segmentType === segmentType) {
      previous.segments.push(segment);
      continue;
    }

    groups.push({
      key: `${segment.segmentId}:group`,
      speakerName,
      segmentType,
      segments: [segment],
    });
  }

  return groups;
}

function findActiveSegmentIndex(currentTime: number, segments: TranscriptSegment[]) {
  let candidate = -1;

  for (const segment of segments) {
    if (segment.startSeconds === null) {
      continue;
    }

    if (segment.startSeconds <= currentTime) {
      candidate = segment.segmentIndex;
    }

    if (
      segment.startSeconds <= currentTime &&
      (segment.endSeconds === null || currentTime < segment.endSeconds + 0.35)
    ) {
      return segment.segmentIndex;
    }

    if (segment.startSeconds > currentTime) {
      break;
    }
  }

  return candidate;
}

function topEpisodeReferences(references: TranscriptReference[]) {
  return references
    .filter((reference) => reference.sourceScope === "episode" && reference.reference)
    .slice(0, 80);
}

export function TranscriptReader({ audioUrl, segments, references }: TranscriptReaderProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [followAudio, setFollowAudio] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segmentRefs = useRef(new Map<number, HTMLElement>());
  const groupedSegments = useMemo(() => groupSegments(segments), [segments]);
  const episodeReferences = useMemo(() => topEpisodeReferences(references), [references]);

  useEffect(() => {
    if (!followAudio || activeIndex === null) {
      return;
    }

    segmentRefs.current.get(activeIndex)?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [activeIndex, followAudio]);

  const seekTo = (seconds: number | null) => {
    if (seconds === null || !audioRef.current) {
      return;
    }

    audioRef.current.currentTime = seconds;
    setActiveIndex(findActiveSegmentIndex(seconds, segments));
  };

  const onTimeUpdate = () => {
    if (!audioRef.current) {
      return;
    }

    setActiveIndex(findActiveSegmentIndex(audioRef.current.currentTime, segments));
  };

  if (segments.length === 0) {
    return <p className="empty-state">No readable transcript segments are available for this episode.</p>;
  }

  return (
    <section className="transcript-reader" aria-label="Episode transcript reader">
      <div className="transcript-reader__bar">
        {audioUrl ? (
          <audio ref={audioRef} className="transcript-reader__audio" controls preload="none" src={audioUrl} onTimeUpdate={onTimeUpdate}>
            <track kind="captions" />
            Your browser does not support audio playback.
          </audio>
        ) : (
          <p className="note">Audio is not available for this episode.</p>
        )}
        <label className="transcript-reader__follow">
          <input
            type="checkbox"
            checked={followAudio}
            onChange={(event) => setFollowAudio(event.target.checked)}
          />
          Follow audio
        </label>
      </div>

      <div className="transcript-reader__layout">
        <div className="transcript-reader__segments">
          {groupedSegments.map((group) => (
            <section key={group.key} className="transcript-speaker-group">
              <div className="transcript-speaker-group__head">
                <h4>{group.speakerName}</h4>
                <span>{typeLabel(group.segmentType)}</span>
              </div>
              {group.segments.map((segment) => {
                const bibleLabels = segment.bibleReferences.map(referenceLabel).filter(Boolean);
                const otherLabels = segment.otherReferences.map(referenceLabel).filter(Boolean);
                const isActive = activeIndex === segment.segmentIndex;

                return (
                  <article
                    key={segment.segmentId}
                    ref={(element) => {
                      if (element) {
                        segmentRefs.current.set(segment.segmentIndex, element);
                      } else {
                        segmentRefs.current.delete(segment.segmentIndex);
                      }
                    }}
                    className={`reader-segment ${isActive ? "reader-segment--active" : ""}`}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <button
                      className="reader-segment__time"
                      type="button"
                      disabled={segment.startSeconds === null || !audioUrl}
                      onClick={() => seekTo(segment.startSeconds)}
                    >
                      {timeLabel(segment)}
                    </button>
                    <p>{segment.text || "Transcript text unavailable."}</p>
                    {bibleLabels.length || otherLabels.length ? (
                      <div className="reader-segment__refs" aria-label="References in this segment">
                        {bibleLabels.slice(0, 4).map((label) => (
                          <span key={`bible-${segment.segmentId}-${label}`}>{label}</span>
                        ))}
                        {otherLabels.slice(0, 3).map((label) => (
                          <span key={`other-${segment.segmentId}-${label}`}>{label}</span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </section>
          ))}
        </div>

        {episodeReferences.length > 0 ? (
          <aside className="transcript-reference-panel">
            <h4>References</h4>
            <div className="transcript-reference-list">
              {episodeReferences.map((reference) => (
                <button
                  key={reference.referenceId}
                  type="button"
                  className="transcript-reference"
                  disabled={reference.startSeconds === null || !audioUrl}
                  onClick={() => seekTo(reference.startSeconds)}
                >
                  <strong>{reference.reference}</strong>
                  <span>{reference.startTime || reference.referenceType}</span>
                  {reference.context || reference.text ? <p>{reference.context || reference.text}</p> : null}
                </button>
              ))}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
