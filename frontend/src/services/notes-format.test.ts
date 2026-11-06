import { describe, expect, it } from "vitest";

import type { NotesDocument } from "./audio-backend-client";
import { notesToMarkdown, notesToText } from "./notes-format";

const notes: NotesDocument = {
  title: "Release Plan",
  summary: "The release is planned.",
  keyPoints: ["Release on Friday."],
  actionItems: [{ task: "Ship it", owner: "Alex", deadline: "Friday" }],
  importantInformation: ["Version 1.0"],
  decisions: [],
  additionalContext: [],
};

describe("notes export", () => {
  it("formats generated notes as Markdown and omits empty sections", () => {
    const markdown = notesToMarkdown(notes);
    expect(markdown).toContain("# Release Plan");
    expect(markdown).toContain("## Action Items\n\n- Ship it (Owner: Alex; Deadline: Friday)");
    expect(markdown).not.toContain("## Decisions");
  });

  it("formats a plain-text export with headings and bullets", () => {
    const text = notesToText(notes);
    expect(text).toContain("Release Plan");
    expect(text).toContain("• Release on Friday.");
    expect(text).not.toContain("##");
  });
});
