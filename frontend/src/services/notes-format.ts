import type { NotesActionItem, NotesDocument } from "./audio-backend-client";

export function notesToMarkdown(notes: NotesDocument): string {
  const sections = [`# ${notes.title}`];
  appendText(sections, "Summary", notes.summary);
  appendList(sections, "Key Points", notes.keyPoints);
  appendList(sections, "Action Items", notes.actionItems.map(formatActionItem));
  appendList(sections, "Important Information", notes.importantInformation);
  appendList(sections, "Decisions", notes.decisions);
  appendList(sections, "Additional Context", notes.additionalContext);
  return `${sections.join("\n\n")}\n`;
}

export function notesToText(notes: NotesDocument): string {
  return notesToMarkdown(notes).replace(/^# /gm, "").replace(/^## /gm, "").replace(/^- /gm, "• ");
}

export function downloadNotes(notes: NotesDocument, format: "md" | "txt"): void {
  const content = format === "md" ? notesToMarkdown(notes) : notesToText(notes);
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(notes.title) || "noto-notes"}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

function appendText(sections: string[], heading: string, value: string | null): void {
  if (value) sections.push(`## ${heading}\n\n${value}`);
}

function appendList(sections: string[], heading: string, values: string[]): void {
  if (values.length > 0)
    sections.push(`## ${heading}\n\n${values.map((value) => `- ${value}`).join("\n")}`);
}

function formatActionItem(item: NotesActionItem): string {
  const metadata = [
    item.owner ? `Owner: ${item.owner}` : null,
    item.deadline ? `Deadline: ${item.deadline}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  return metadata ? `${item.task} (${metadata})` : item.task;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
