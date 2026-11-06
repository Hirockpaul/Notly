import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { NotesDocument } from "../../services/audio-backend-client";
import { NotesPanel } from "./NotesPanel";

const notes: NotesDocument = {
  title: "Release notes",
  summary: "A grounded summary.",
  keyPoints: ["One key point"],
  actionItems: [{ task: "Follow up", owner: null, deadline: null }],
  importantInformation: [],
  decisions: ["Ship on Friday"],
  additionalContext: [],
};

describe("NotesPanel", () => {
  it("renders the explicit generation action and disabled loading state", () => {
    const idle = renderToStaticMarkup(
      <NotesPanel canGenerate error={null} notes={null} onGenerate={vi.fn()} status="idle" />,
    );
    const loading = renderToStaticMarkup(
      <NotesPanel canGenerate error={null} notes={null} onGenerate={vi.fn()} status="generating" />,
    );
    expect(idle).toContain("Generate Notes");
    expect(loading).toContain("Generating...");
    expect(loading).toContain("disabled");
  });

  it("renders errors, generated sections, and regeneration without header export actions", () => {
    const failed = renderToStaticMarkup(
      <NotesPanel
        canGenerate
        error="Provider failed"
        notes={null}
        onGenerate={vi.fn()}
        status="error"
      />,
    );
    const generated = renderToStaticMarkup(
      <NotesPanel canGenerate error={null} notes={notes} onGenerate={vi.fn()} status="generated" />,
    );
    const regenerating = renderToStaticMarkup(
      <NotesPanel
        canGenerate
        error={null}
        notes={notes}
        onGenerate={vi.fn()}
        status="regenerating"
      />,
    );

    expect(failed).toContain("Provider failed");
    expect(generated).toContain("A grounded summary.");
    expect(generated).toContain("One key point");
    expect(generated).not.toContain("Copy all");
    expect(generated).not.toContain(">.md<");
    expect(generated).not.toContain(">.txt<");
    expect(generated).toContain("Regenerate");
    expect(regenerating).toContain("Regenerating...");
  });

  it("offers explicit Discord delivery when saved-session metadata is available", () => {
    const generated = renderToStaticMarkup(
      <NotesPanel
        canGenerate={false}
        delivery={{
          title: "Release recording",
          createdAt: "2026-11-05T10:00:00Z",
          durationSeconds: 90,
        }}
        error={null}
        notes={notes}
        onGenerate={vi.fn()}
        status="generated"
      />,
    );
    expect(generated).toContain("Send to Discord");
  });
});
