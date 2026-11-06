import { AlertCircle, Copy, FileText, RefreshCw, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "../../components/ui/Button";
import type { NotesDocument } from "../../services/audio-backend-client";
import { recordDiscordDelivery, sendNotesToDiscord } from "../../services/desktop-integrations";

export type NotesUiStatus = "idle" | "generating" | "generated" | "error" | "regenerating";

interface NotesPanelProps {
  canGenerate: boolean;
  error: string | null;
  notes: NotesDocument | null;
  onGenerate: (regenerate: boolean) => void;
  status: NotesUiStatus;
  delivery?: { title: string; createdAt: string; durationSeconds: number };
}

export function NotesPanel({
  canGenerate,
  delivery,
  error,
  notes,
  onGenerate,
  status,
}: NotesPanelProps) {
  const busy = status === "generating" || status === "regenerating";
  const [sending, setSending] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState<string | null>(null);
  const [resumeAt, setResumeAt] = useState(0);

  const sendToDiscord = async () => {
    if (!notes || !delivery || sending) return;
    if (
      !window.confirm(
        `Send “${delivery.title}” and its structured notes to the configured Discord channel?`,
      )
    )
      return;
    setSending(true);
    setDeliveryMessage(null);
    try {
      const result = await sendNotesToDiscord({ ...delivery, notes, startAt: resumeAt });
      setResumeAt(0);
      const message = `Sent to Discord in ${result.totalMessages} message${result.totalMessages === 1 ? "" : "s"}.`;
      setDeliveryMessage(message);
      recordDiscordDelivery({ kind: "success", message });
    } catch (sendError) {
      const detail = deliveryError(sendError);
      setResumeAt(detail.deliveredMessages);
      setDeliveryMessage(detail.message);
      recordDiscordDelivery({ kind: "error", message: detail.message });
    } finally {
      setSending(false);
    }
  };

  if (!notes) {
    return (
      <div className="grid min-h-72 place-items-center rounded-[10px] border border-dashed border-[#383838] p-8 text-center">
        <div className="max-w-sm">
          {error ? (
            <AlertCircle className="mx-auto text-[#EF4444]" size={24} />
          ) : (
            <Sparkles className="mx-auto text-[#F5F5F5]" size={24} />
          )}
          <h3 className="mt-4 text-sm font-semibold">
            {error ? "Notes generation failed" : busy ? "Generating grounded notes..." : "AI notes"}
          </h3>
          <p className={`mt-2 text-xs leading-5 ${error ? "text-[#EF4444]/80" : "text-[#737373]"}`}>
            {error ??
              (canGenerate
                ? "Generate structured notes only when you are ready. Your transcript remains unchanged."
                : "Complete a recording with meaningful speech before generating notes.")}
          </p>
          <Button
            className="mt-5"
            disabled={!canGenerate || busy}
            onClick={() => onGenerate(false)}
          >
            <Sparkles size={15} /> {busy ? "Generating..." : error ? "Try again" : "Generate Notes"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#383838] pb-5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-[#343434] text-[#F5F5F5]">
            <FileText size={18} />
          </span>
          <div>
            <span className="text-xs font-medium text-[#737373]">Generated from transcript</span>
            <h3 className="mt-1 text-lg font-semibold">{notes.title}</h3>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {delivery ? (
            <Button
              disabled={sending}
              onClick={() => void sendToDiscord()}
              size="small"
              variant="secondary"
            >
              <Send size={13} />{" "}
              {sending ? "Sending..." : resumeAt > 0 ? "Retry remaining" : "Send to Discord"}
            </Button>
          ) : null}
          {canGenerate ? (
            <Button disabled={busy} onClick={() => onGenerate(true)} size="small">
              <RefreshCw className={busy ? "animate-spin" : ""} size={13} />
              {status === "regenerating" ? "Regenerating..." : "Regenerate"}
            </Button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="mt-4 text-xs text-[#EF4444]" role="alert">
          {error}
        </p>
      ) : null}
      {deliveryMessage ? (
        <p className="mt-4 text-xs text-[#F5F5F5]" role="status">
          {deliveryMessage}
        </p>
      ) : null}
      <div className="mt-5 grid gap-6">
        {notes.summary ? <NotesSection heading="Summary" text={notes.summary} /> : null}
        <NotesList heading="Key Points" values={notes.keyPoints} />
        {notes.actionItems.length > 0 ? (
          <NotesSection
            heading="Action Items"
            copyText={notes.actionItems.map((item) => item.task).join("\n")}
          >
            <div className="grid gap-2">
              {notes.actionItems.map((item) => (
                <div
                  className="rounded-lg border border-[#383838] bg-[#303030] p-3"
                  key={`${item.task}-${item.owner}-${item.deadline}`}
                >
                  <p className="text-xs text-[#F5F5F5]">{item.task}</p>
                  {item.owner || item.deadline ? (
                    <p className="mt-1 text-[10px] text-[#737373]">
                      {[
                        item.owner ? `Owner: ${item.owner}` : null,
                        item.deadline ? `Deadline: ${item.deadline}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </NotesSection>
        ) : null}
        <NotesList heading="Important Information" values={notes.importantInformation} />
        <NotesList heading="Decisions" values={notes.decisions} />
        <NotesList heading="Additional Context" values={notes.additionalContext} />
      </div>
    </div>
  );
}

function deliveryError(error: unknown): { message: string; deliveredMessages: number } {
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; deliveredMessages?: unknown };
    return {
      message:
        typeof candidate.message === "string"
          ? candidate.message
          : "Discord delivery failed. Your local notes were not changed.",
      deliveredMessages:
        typeof candidate.deliveredMessages === "number" ? candidate.deliveredMessages : 0,
    };
  }
  return {
    message:
      typeof error === "string"
        ? error
        : "Discord delivery failed. Your local notes were not changed.",
    deliveredMessages: 0,
  };
}

interface NotesSectionProps {
  children?: ReactNode;
  copyText?: string;
  heading: string;
  text?: string;
}

function NotesSection({ children, copyText, heading, text }: NotesSectionProps) {
  const content = copyText ?? text ?? "";
  return (
    <section>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold tracking-[0.08em] text-[#A3A3A3] uppercase">{heading}</h4>
        <button
          aria-label={`Copy ${heading}`}
          className="cursor-pointer text-[#737373] hover:text-[#F5F5F5]"
          onClick={() => void navigator.clipboard.writeText(content)}
          type="button"
        >
          <Copy size={13} />
        </button>
      </div>
      {text ? <p className="mt-2 text-xs leading-6 text-[#A3A3A3]">{text}</p> : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </section>
  );
}

function NotesList({ heading, values }: { heading: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <NotesSection copyText={values.join("\n")} heading={heading}>
      <ul className="grid gap-2 text-xs leading-5 text-[#A3A3A3]">
        {values.map((value) => (
          <li className="grid grid-cols-[8px_1fr] gap-2" key={value}>
            <span className="mt-2 size-1 rounded-full bg-[#3B82F6]" />
            <span>{value}</span>
          </li>
        ))}
      </ul>
    </NotesSection>
  );
}
