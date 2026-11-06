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
        <h2 className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
        {description ? <p className="mt-1 text-xs text-[#737373]">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}
