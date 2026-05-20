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

type SegmentReference = {
  key: string;
  label: string;
  detail: string;
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

function referenceDetail(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const candidate = value as { context?: unknown; text?: unknown };
  for (const key of ["context", "text"] as const) {
    const item = candidate[key];
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }
  }

  return "";
}

function typeLabel(value: string) {
  if (!value || value === "speech") {
    return "";
  }

  return value.replaceAll("_", " ").trim();
}

function segmentReferenceItems(segment: TranscriptSegment): SegmentReference[] {
  const references = [...segment.bibleReferences, ...segment.otherReferences];
  const seen = new Set<string>();

  return references.reduce<SegmentReference[]>((items, reference, index) => {
    const label = referenceLabel(reference);
    if (!label) {
      return items;
    }

    const detail = referenceDetail(reference);
    const key = `${label}:${detail}`;
    if (seen.has(key)) {
      return items;
    }

    seen.add(key);
    items.push({
      key: `${segment.segmentId}-reference-${index}`,
      label,
      detail,
    });

    return items;
  }, []);
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

export function TranscriptReader({ audioUrl, segments }: TranscriptReaderProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [followAudio, setFollowAudio] = useState(true);
  const [openReferenceSegment, setOpenReferenceSegment] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segmentRefs = useRef(new Map<number, HTMLElement>());
  const groupedSegments = useMemo(() => groupSegments(segments), [segments]);

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
                {typeLabel(group.segmentType) ? <span>{typeLabel(group.segmentType)}</span> : null}
              </div>
              {group.segments.map((segment) => {
                const segmentReferences = segmentReferenceItems(segment);
                const isActive = activeIndex === segment.segmentIndex;
                const referencePanelId = `${segment.segmentId}-references`;
                const isReferenceOpen = openReferenceSegment === segment.segmentId;

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
                    <p>{segment.text || "Transcript text unavailable."}</p>
                    {segmentReferences.length ? (
                      <div
                        className={`reader-segment__references ${isReferenceOpen ? "reader-segment__references--open" : ""}`}
                      >
                        <button
                          type="button"
                          className="reader-segment__ref-trigger"
                          aria-expanded={isReferenceOpen}
                          aria-controls={referencePanelId}
                          onClick={() =>
                            setOpenReferenceSegment(isReferenceOpen ? null : segment.segmentId)
                          }
                        >
                          References
                        </button>
                        <div id={referencePanelId} className="reader-segment__ref-popover">
                          <div className="reader-segment__ref-list" aria-label="References in this segment">
                            {segmentReferences.map((reference) => (
                              <button
                                key={reference.key}
                                type="button"
                                className="reader-segment__ref-item"
                                disabled={segment.startSeconds === null || !audioUrl}
                                onClick={() => seekTo(segment.startSeconds)}
                              >
                                <strong>{reference.label}</strong>
                                {reference.detail ? <span>{reference.detail}</span> : null}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
