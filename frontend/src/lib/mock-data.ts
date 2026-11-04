import type { Note, TranscriptLine } from "../types/content";

export const notes: Note[] = [
  {
    id: "product-sync",
    title: "Product strategy sync",
    date: "Today",
    time: "10:32 AM",
    duration: "38 min",
    preview:
      "Aligned on the Q4 product direction, onboarding priorities, and the release sequence.",
    tags: ["Product", "Planning"],
    points: [
      "Prioritize the simplified onboarding flow for the next release.",
      "Move the workspace templates experiment into the Q4 validation track.",
      "Share the revised delivery sequence before Friday's review.",
    ],
  },
  {
    id: "design-review",
    title: "Design review — desktop flow",
    date: "Yesterday",
    time: "4:15 PM",
    duration: "24 min",
    preview: "Reviewed the desktop navigation model and agreed on a quieter recording experience.",
    tags: ["Design"],
    points: [
      "Use one persistent recording control across the desktop experience.",
      "Reduce visual noise in the transcript and keep speaker colors subtle.",
      "Test navigation at the minimum supported window width.",
    ],
  },
  {
    id: "weekly-reflection",
    title: "Weekly reflection",
    date: "Oct 31",
    time: "6:40 PM",
    duration: "12 min",
    preview: "Captured progress, open questions, and the three priorities for the coming week.",
    tags: ["Personal"],
    points: [
      "Protect two focused blocks for foundational engineering work.",
      "Close the open product positioning questions.",
      "Prepare a smaller, testable scope for the next milestone.",
    ],
  },
  {
    id: "research-call",
    title: "Customer research call",
    date: "Oct 29",
    time: "11:05 AM",
    duration: "46 min",
    preview:
      "Discussed how independent teams capture meetings and turn raw conversations into action.",
    tags: ["Research"],
    points: [
      "Fast retrieval matters more than extensive organization controls.",
      "People want important points separated from the full transcript.",
      "Export should feel immediate and require minimal configuration.",
    ],
  },
];

export const transcript: TranscriptLine[] = [
  {
    id: "line-1",
    speaker: "You",
    timestamp: "00:08",
    content:
      "Let's use this time to align on the launch sequence and make sure the handoffs are clear.",
    color: "indigo",
  },
  {
    id: "line-2",
    speaker: "Speaker 2",
    timestamp: "00:19",
    content:
      "The design system is in good shape. I would keep the first release focused on the core desktop flow.",
    color: "cyan",
  },
  {
    id: "line-3",
    speaker: "Speaker 3",
    timestamp: "00:34",
    content: "Agreed. We should also define a small test plan before audio capture is connected.",
    color: "amber",
  },
  {
    id: "line-4",
    speaker: "You",
    timestamp: "00:48",
    content: "I'll capture that as the next action and share a concise rollout checklist.",
    color: "indigo",
  },
];
