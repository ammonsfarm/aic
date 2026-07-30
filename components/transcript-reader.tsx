"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

type TranscriptSegment = {
  segmentId: string;
  segmentIndex: number;
  startSeconds: number | null;
  endSeconds: number | null;
  speakerName: string;
  segmentType: string;
  text: string;
};

type TranscriptReaderProps = {
  audioUrl: string;
  canEditTranscript: boolean;
  segments: TranscriptSegment[];
  controlsAfter?: ReactNode;
  trackId: string;
};

type TranscriptParagraph = {
  key: string;
  segments: TranscriptSegment[];
};

function normalizedSegmentText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function hasSentenceEnding(value: string) {
  return /[.!?]["')\]]?$/.test(value.trim());
}

function buildParagraphs(segments: TranscriptSegment[]) {
  const paragraphs: TranscriptParagraph[] = [];
  let current: TranscriptSegment[] = [];
  let currentLength = 0;

  for (const segment of segments) {
    const text = normalizedSegmentText(segment.text);
    if (!text) {
      continue;
    }

    current.push(segment);
    currentLength += text.length + 1;

    if ((currentLength > 520 && hasSentenceEnding(text)) || currentLength > 900) {
      paragraphs.push({
        key: `${current[0].segmentId}:paragraph`,
        segments: current,
      });
      current = [];
      currentLength = 0;
    }
  }

  if (current.length) {
    paragraphs.push({
      key: `${current[0].segmentId}:paragraph`,
      segments: current,
    });
  }

  return paragraphs;
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

function scrollElementIntoReader(element: HTMLElement, container: HTMLElement) {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const offset = elementRect.top - containerRect.top;
  const targetTop = container.scrollTop + offset - container.clientHeight * 0.38;

  container.scrollTo({
    top: Math.max(0, targetTop),
    behavior: "smooth",
  });
}

function wordParts(value: string) {
  return normalizedSegmentText(value).split(/(\s+)/).filter(Boolean);
}

function formatSeekTime(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;
  const parts: string[] = [];

  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (remainder || parts.length === 0) parts.push(`${remainder} second${remainder === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function seekLabel(segment: TranscriptSegment, position: number, total: number) {
  const text = normalizedSegmentText(segment.text);
  const excerpt = text.length > 120 ? `${text.slice(0, 117)}…` : text;
  return `Seek to ${formatSeekTime(segment.startSeconds ?? 0)}, transcript segment ${position} of ${total}: ${excerpt}`;
}

export function nextTranscriptTabStop(currentIndex: number, seekableIndexes: number[], key: string) {
  if (seekableIndexes.length === 0) return null;

  const currentPosition = Math.max(0, seekableIndexes.indexOf(currentIndex));
  if (key === "Home") return seekableIndexes[0];
  if (key === "End") return seekableIndexes.at(-1) ?? null;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return seekableIndexes[Math.min(currentPosition + 1, seekableIndexes.length - 1)];
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return seekableIndexes[Math.max(currentPosition - 1, 0)];
  }
  return null;
}

function activeWordIndex(segment: TranscriptSegment, currentTime: number, text: string) {
  if (segment.startSeconds === null || segment.endSeconds === null || segment.endSeconds <= segment.startSeconds) {
    return null;
  }

  if (currentTime < segment.startSeconds || currentTime > segment.endSeconds + 0.35) {
    return null;
  }

  const wordCount = wordParts(text).filter((part) => !/^\s+$/.test(part)).length;
  if (wordCount === 0) {
    return null;
  }

  const progress = Math.min(0.999, Math.max(0, (currentTime - segment.startSeconds) / (segment.endSeconds - segment.startSeconds)));
  return Math.min(wordCount - 1, Math.floor(progress * wordCount));
}

function SegmentText({
  segment,
  isActive,
  currentTime,
}: {
  segment: TranscriptSegment;
  isActive: boolean;
  currentTime: number;
}) {
  const text = normalizedSegmentText(segment.text);
  const highlightedWord = isActive ? activeWordIndex(segment, currentTime, text) : null;

  if (highlightedWord === null) {
    return <>{text}</>;
  }

  const parts = wordParts(text);

  return (
    <>
      {parts.map((part, index) => {
        if (/^\s+$/.test(part)) {
          return <span key={`${segment.segmentId}:space:${index}`}>{part}</span>;
        }

        const wordIndex = parts.slice(0, index + 1).filter((candidate) => !/^\s+$/.test(candidate)).length - 1;
        const isWordActive = wordIndex === highlightedWord;
        return (
          <span
            key={`${segment.segmentId}:word:${index}`}
            className={isWordActive ? "reader-word reader-word--active" : "reader-word"}
            aria-current={isWordActive ? "true" : undefined}
          >
            {part}
          </span>
        );
      })}
    </>
  );
}

export function TranscriptReader({
  audioUrl,
  canEditTranscript,
  controlsAfter,
  segments,
  trackId,
}: TranscriptReaderProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [followAudio, setFollowAudio] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [savingSegmentId, setSavingSegmentId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [queuedEdits, setQueuedEdits] = useState<Record<string, string>>({});
  const [editedTextBySegment, setEditedTextBySegment] = useState<Record<string, string>>({});
  const [rovingSegmentIndex, setRovingSegmentIndex] = useState<number | null>(() => (
    audioUrl ? segments.find((segment) => segment.startSeconds !== null)?.segmentIndex ?? null : null
  ));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptViewportRef = useRef<HTMLDivElement | null>(null);
  const segmentRefs = useRef(new Map<number, HTMLElement>());
  const visibleSegments = useMemo(
    () =>
      segments.map((segment) => ({
        ...segment,
        text: editedTextBySegment[segment.segmentId] ?? segment.text,
      })),
    [editedTextBySegment, segments],
  );
  const paragraphs = useMemo(() => buildParagraphs(visibleSegments), [visibleSegments]);
  const seekableSegmentIndexes = useMemo(
    () => audioUrl
      ? visibleSegments.filter((segment) => segment.startSeconds !== null).map((segment) => segment.segmentIndex)
      : [],
    [audioUrl, visibleSegments],
  );
  const effectiveRovingSegmentIndex = rovingSegmentIndex !== null && seekableSegmentIndexes.includes(rovingSegmentIndex)
    ? rovingSegmentIndex
    : seekableSegmentIndexes[0] ?? null;

  useEffect(() => {
    if (!followAudio || activeIndex === null) {
      return;
    }

    const element = segmentRefs.current.get(activeIndex);
    const container = transcriptViewportRef.current;
    if (element && container) {
      scrollElementIntoReader(element, container);
    }
  }, [activeIndex, followAudio]);

  const seekTo = (seconds: number | null) => {
    if (seconds === null || !audioRef.current) {
      return;
    }

    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
    setActiveIndex(findActiveSegmentIndex(seconds, visibleSegments));
  };

  const onTimeUpdate = () => {
    if (!audioRef.current) {
      return;
    }

    const time = audioRef.current.currentTime;
    setCurrentTime(time);
    setActiveIndex(findActiveSegmentIndex(time, visibleSegments));
  };

  const handleSegmentKeyDown = (event: KeyboardEvent<HTMLElement>, segment: TranscriptSegment) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setRovingSegmentIndex(segment.segmentIndex);
      seekTo(segment.startSeconds);
      return;
    }

    const nextIndex = nextTranscriptTabStop(segment.segmentIndex, seekableSegmentIndexes, event.key);
    if (nextIndex === null) return;

    event.preventDefault();
    setRovingSegmentIndex(nextIndex);
    segmentRefs.current.get(nextIndex)?.focus();
  };

  const startEditing = (segment: TranscriptSegment) => {
    if (!canEditTranscript) {
      return;
    }

    setEditingSegmentId(segment.segmentId);
    setDraftText(normalizedSegmentText(segment.text));
    setEditError(null);
  };

  const cancelEditing = () => {
    setEditingSegmentId(null);
    setDraftText("");
    setEditError(null);
  };

  const saveEdit = async (segment: TranscriptSegment) => {
    if (!canEditTranscript) {
      setEditError("Your role cannot submit transcript corrections.");
      return;
    }

    const editedText = normalizedSegmentText(draftText);
    const originalText = normalizedSegmentText(segment.text);

    if (!editedText || editedText === originalText) {
      setEditError("Change the transcript text before saving.");
      return;
    }

    setSavingSegmentId(segment.segmentId);
    setEditError(null);

    try {
      const response = await fetch(`/api/episodes/${encodeURIComponent(trackId)}/transcript-edits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segmentId: segment.segmentId,
          originalText,
          editedText,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        edit?: { id?: string; status?: string };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Transcript edit could not be saved.");
      }

      setEditedTextBySegment((current) => ({ ...current, [segment.segmentId]: editedText }));
      setQueuedEdits((current) => ({ ...current, [segment.segmentId]: payload.edit?.id ?? "pending" }));
      setEditingSegmentId(null);
      setDraftText("");
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Transcript edit could not be saved.");
    } finally {
      setSavingSegmentId(null);
    }
  };

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
        {visibleSegments.length > 0 ? (
          <label className="transcript-reader__follow">
            <input
              type="checkbox"
              checked={followAudio}
              onChange={(event) => setFollowAudio(event.target.checked)}
            />
            Follow audio
          </label>
        ) : null}
        {canEditTranscript && visibleSegments.length > 0 ? (
          <button
            type="button"
            className={`button ${editMode ? "button--primary" : "button--ghost"} transcript-reader__edit-toggle`}
            aria-pressed={editMode}
            onClick={() => {
              setEditMode((value) => !value);
              cancelEditing();
            }}
          >
            {editMode ? "Done editing" : "Edit transcript"}
          </button>
        ) : null}
      </div>

      {controlsAfter ? <div className="transcript-reader__controls-after">{controlsAfter}</div> : null}

      <div ref={transcriptViewportRef} className="transcript-reader__layout">
        {visibleSegments.length === 0 ? (
          <p className="empty-state" role="status">No readable transcript segments are available for this episode.</p>
        ) : null}
        {canEditTranscript && editMode ? (
          <div className="transcript-reader__edit-note" role="status">
            Corrections are queued for review, transcript-table updates, and re-vectorization.
          </div>
        ) : null}
        <div className="transcript-reader__segments" role="group" aria-label="Transcript seek controls">
          {paragraphs.map((paragraph) => (
            <p key={paragraph.key} className="transcript-paragraph">
              {paragraph.segments.map((segment, index) => {
                const isActive = activeIndex === segment.segmentIndex;
                const canSeek = segment.startSeconds !== null && Boolean(audioUrl);
                const isEditing = canEditTranscript && editingSegmentId === segment.segmentId;
                const queuedEditId = queuedEdits[segment.segmentId];
                const seekablePosition = seekableSegmentIndexes.indexOf(segment.segmentIndex);

                return (
                  <span key={segment.segmentId} className="reader-segment-wrap">
                    {index > 0 ? " " : null}
                    {isEditing ? (
                      <span className="reader-segment-editor">
                        <textarea
                          value={draftText}
                          rows={4}
                          aria-label="Edit transcript segment"
                          onChange={(event) => setDraftText(event.target.value)}
                        />
                        {editError ? <span className="reader-segment-editor__error">{editError}</span> : null}
                        <span className="reader-segment-editor__actions">
                          <button
                            type="button"
                            className="button button--primary"
                            disabled={savingSegmentId === segment.segmentId}
                            onClick={() => void saveEdit(segment)}
                          >
                            {savingSegmentId === segment.segmentId ? "Saving" : "Save correction"}
                          </button>
                          <button
                            type="button"
                            className="button button--ghost"
                            disabled={savingSegmentId === segment.segmentId}
                            onClick={cancelEditing}
                          >
                            Cancel
                          </button>
                        </span>
                      </span>
                    ) : (
                      <>
                        <span
                          ref={(element) => {
                            if (element) {
                              segmentRefs.current.set(segment.segmentIndex, element);
                            } else {
                              segmentRefs.current.delete(segment.segmentIndex);
                            }
                          }}
                          className={`reader-segment ${isActive ? "reader-segment--active" : ""}`}
                          aria-current={isActive ? "true" : undefined}
                          role={canSeek ? "button" : undefined}
                          tabIndex={canSeek ? (effectiveRovingSegmentIndex === segment.segmentIndex ? 0 : -1) : undefined}
                          aria-label={canSeek ? seekLabel(segment, seekablePosition + 1, seekableSegmentIndexes.length) : undefined}
                          onClick={canSeek ? () => {
                            setRovingSegmentIndex(segment.segmentIndex);
                            seekTo(segment.startSeconds);
                          } : undefined}
                          onFocus={canSeek ? () => setRovingSegmentIndex(segment.segmentIndex) : undefined}
                          onKeyDown={canSeek ? (event) => handleSegmentKeyDown(event, segment) : undefined}
                        >
                          <SegmentText segment={segment} isActive={isActive} currentTime={currentTime} />
                        </span>
                        {canEditTranscript && editMode ? (
                          <span className="reader-segment-tools">
                            {queuedEditId ? (
                              <span className="reader-segment-status">Queued</span>
                            ) : (
                              <button
                                type="button"
                                className="reader-segment-edit"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  startEditing(segment);
                                }}
                              >
                                Edit
                              </button>
                            )}
                          </span>
                        ) : null}
                      </>
                    )}
                  </span>
                );
              })}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
