export interface Note {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: string;
  preview: string;
  tags: string[];
  points: string[];
}

export interface TranscriptLine {
  id: string;
  speaker: string;
  timestamp: string;
  content: string;
  color: "indigo" | "cyan" | "amber";
}
