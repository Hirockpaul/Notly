import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, description, action }: SectionHeaderProps) {
  return (
    <header className="flex items-start justify-between">
      <div>
        <h2 className="text-base font-bold tracking-[-0.02em]">{title}</h2>
        {description ? <p className="mt-1 text-[11px] text-[#686f80]">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}
