"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  segments: TranscriptSegment[];
  trackId: string;
};

type SegmentGroup = {
  key: string;
  speakerName: string;
  segmentType: string;
  paragraphs: TranscriptParagraph[];
};

type TranscriptParagraph = {
  key: string;
  segments: TranscriptSegment[];
};

function typeLabel(value: string) {
  if (!value || value === "speech") {
    return "";
  }

  return value.replaceAll("_", " ").trim();
}

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

function groupSegments(segments: TranscriptSegment[]): SegmentGroup[] {
  const rawGroups: Array<Omit<SegmentGroup, "paragraphs"> & { segments: TranscriptSegment[] }> = [];

  for (const segment of segments) {
    if (!normalizedSegmentText(segment.text)) {
      continue;
    }

    const speakerName = segment.speakerName || "Speaker";
    const segmentType = segment.segmentType || "speech";
    const previous = rawGroups.at(-1);

    if (previous && previous.speakerName === speakerName && previous.segmentType === segmentType) {
      previous.segments.push(segment);
      continue;
    }

    rawGroups.push({
      key: `${segment.segmentId}:group`,
      speakerName,
      segmentType,
      segments: [segment],
    });
  }

  return rawGroups.map((group) => ({
    key: group.key,
    speakerName: group.speakerName,
    segmentType: group.segmentType,
    paragraphs: buildParagraphs(group.segments),
  }));
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

export function TranscriptReader({ audioUrl, segments, trackId }: TranscriptReaderProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [followAudio, setFollowAudio] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [savingSegmentId, setSavingSegmentId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [queuedEdits, setQueuedEdits] = useState<Record<string, string>>({});
  const [editedTextBySegment, setEditedTextBySegment] = useState<Record<string, string>>({});
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
  const groupedSegments = useMemo(() => groupSegments(visibleSegments), [visibleSegments]);

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
    setActiveIndex(findActiveSegmentIndex(seconds, visibleSegments));
  };

  const onTimeUpdate = () => {
    if (!audioRef.current) {
      return;
    }

    setActiveIndex(findActiveSegmentIndex(audioRef.current.currentTime, visibleSegments));
  };

  const startEditing = (segment: TranscriptSegment) => {
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

  if (visibleSegments.length === 0) {
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
      </div>

      <div ref={transcriptViewportRef} className="transcript-reader__layout">
        {editMode ? (
          <div className="transcript-reader__edit-note" role="status">
            Corrections are queued for review, transcript-table updates, and re-vectorization.
          </div>
        ) : null}
        <div className="transcript-reader__segments">
          {groupedSegments.map((group) => (
            <section key={group.key} className="transcript-speaker-group">
              <div className="transcript-speaker-group__head">
                <h4>{group.speakerName}</h4>
                {typeLabel(group.segmentType) ? <span>{typeLabel(group.segmentType)}</span> : null}
              </div>
              {group.paragraphs.map((paragraph) => (
                <p key={paragraph.key} className="transcript-paragraph">
                  {paragraph.segments.map((segment, index) => {
                    const isActive = activeIndex === segment.segmentIndex;
                    const canSeek = segment.startSeconds !== null && Boolean(audioUrl);
                    const isEditing = editingSegmentId === segment.segmentId;
                    const queuedEditId = queuedEdits[segment.segmentId];

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
                              tabIndex={canSeek ? 0 : undefined}
                              onClick={canSeek ? () => seekTo(segment.startSeconds) : undefined}
                              onKeyDown={canSeek ? (event) => {
                                if (event.key !== "Enter" && event.key !== " ") {
                                  return;
                                }

                                event.preventDefault();
                                seekTo(segment.startSeconds);
                              } : undefined}
                            >
                              {normalizedSegmentText(segment.text)}
                            </span>
                            {editMode ? (
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
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
