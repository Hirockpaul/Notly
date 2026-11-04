import type { AlignedTranscriptSegment, SpeechSessionProgress } from "./audio-backend-client";

export function normalizeTranscriptSegments(
  segments: AlignedTranscriptSegment[],
): AlignedTranscriptSegment[] {
  const unique = new Map(segments.map((segment) => [segment.utterance_id, segment]));
  return [...unique.values()].sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.utterance_id.localeCompare(right.utterance_id),
  );
}

export function getProgressStatus(
  snapshot: SpeechSessionProgress,
): "detecting" | "transcribing" | "processing" | "completed" {
  if (snapshot.status === "completed" || snapshot.status === "completed_with_errors") {
    return "completed";
  }
  if (snapshot.status === "processing") return "processing";
  return snapshot.pendingUtterances > 0 ? "transcribing" : "detecting";
}
