import { CalendarDays, Clock3, FileText, Search, Tag, Users } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { Card } from "../../components/ui/Card";
import { notes } from "../../lib/mock-data";

export function NotesPage() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(notes[0].id);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredNotes = notes.filter((note) =>
    `${note.title} ${note.preview} ${note.tags.join(" ")}`.toLowerCase().includes(normalizedQuery),
  );
  const selectedNote = notes.find((note) => note.id === selectedId) ?? filteredNotes[0] ?? notes[0];

  return (
    <div className="mx-auto max-w-360 px-[clamp(28px,4vw,64px)] pt-11.5 pb-14">
      <header className="mb-7 flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold tracking-[0.12em] text-[#686f80] uppercase">
            Your library
          </span>
          <h1 className="mt-2 text-[clamp(29px,3vw,38px)] leading-tight font-semibold tracking-[-0.045em]">
            My Notes
          </h1>
          <p className="mt-2.5 text-sm text-[#9298a7]">
            Revisit conversations and the ideas worth keeping.
          </p>
        </div>
        <span className="rounded-full border border-[#252936] bg-white/3 px-3 py-2 text-[11px] text-[#9298a7]">
          {notes.length} notes
        </span>
      </header>

      <div className="grid grid-cols-[minmax(280px,.8fr)_minmax(0,1.4fr)] gap-4">
        <Card className="p-4">
          <label className="flex items-center gap-2 rounded-[10px] border border-[#252936] bg-[#0d0f14] px-3 text-[#686f80] focus-within:border-indigo-400/60">
            <Search aria-hidden="true" size={17} />
            <span className="sr-only">Search notes</span>
            <input
              className="min-w-0 flex-1 border-0 bg-transparent py-3 text-[#f4f5f7] outline-none placeholder:text-[#686f80]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search notes..."
              type="search"
              value={query}
            />
            <kbd className="rounded border border-[#252936] bg-[#1a1d27] px-1.5 py-0.5 text-[9px] text-[#686f80]">
              ⌘ K
            </kbd>
          </label>
          <div className="mt-3 grid gap-1" aria-label="Notes">
            {filteredNotes.map((note) => (
              <button
                aria-pressed={selectedNote.id === note.id}
                className={`cursor-pointer rounded-xl border p-3.5 text-left transition ${selectedNote.id === note.id ? "border-indigo-400/25 bg-indigo-400/10" : "border-transparent bg-transparent hover:bg-white/3"}`}
                key={note.id}
                onClick={() => setSelectedId(note.id)}
                type="button"
              >
                <div>
                  <strong className="block text-xs">{note.title}</strong>
                  <span className="mt-1 block text-[10px] text-[#686f80]">
                    {note.date} · {note.time}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-[#9298a7]">
                  {note.preview}
                </p>
                <div className="mt-3 flex items-center justify-between text-[10px] text-[#686f80]">
                  <span className="flex items-center gap-1">
                    <Clock3 size={12} /> {note.duration}
                  </span>
                  <span>{note.tags[0]}</span>
                </div>
              </button>
            ))}
            {filteredNotes.length === 0 ? (
              <div className="grid place-items-center gap-2 py-12 text-center text-xs text-[#686f80]">
                <Search size={22} />
                <p>No notes match “{query}”.</p>
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="p-7" variant="elevated">
          <div className="flex items-center gap-3.5">
            <div className="flex size-10 items-center justify-center rounded-[10px] bg-white/5 text-[#9298a7]">
              <FileText size={20} />
            </div>
            <div>
              <span className="text-[10px] font-bold tracking-[0.12em] text-[#686f80] uppercase">
                Conversation note
              </span>
              <h2 className="mt-1 text-xl tracking-tight">{selectedNote.title}</h2>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-5 border-y border-[#252936] py-4 text-[11px] text-[#9298a7]">
            <span className="flex items-center gap-1.5">
              <CalendarDays size={14} /> {selectedNote.date}, {selectedNote.time}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock3 size={14} /> {selectedNote.duration}
            </span>
            <span className="flex items-center gap-1.5">
              <Users size={14} /> 3 speakers
            </span>
          </div>
          <div className="mt-7">
            <span className="text-[10px] font-bold tracking-[0.12em] text-[#686f80] uppercase">
              Summary
            </span>
            <p className="mt-3 text-[13px] leading-7 text-[#9298a7]">
              {selectedNote.preview} The discussion produced a clear set of next steps and owners.
            </p>
          </div>
          <div className="mt-7">
            <h3 className="mb-3 text-sm">Important points</h3>
            {selectedNote.points.map((point, index) => (
              <div
                className="grid grid-cols-[28px_1fr] gap-3 border-t border-[#252936] py-3 first:border-0"
                key={point}
              >
                <span className="text-[10px] text-indigo-300">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="text-xs leading-5 text-[#9298a7]">{point}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-center gap-2 text-[10px] text-[#686f80]">
            <Tag size={14} />
            {selectedNote.tags.map((tag) => (
              <span className="rounded-full bg-white/5 px-2 py-1" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
