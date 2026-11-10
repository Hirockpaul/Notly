import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  variant?: "default" | "elevated";
}

export function Card({ children, className = "", variant = "default", ...props }: CardProps) {
  return (
    <section
      className={`rounded-[14px] border border-[#383838] ${variant === "elevated" ? "bg-[#2D2D2D]" : "bg-[#252525]"} ${className}`.trim()}
      {...props}
    >
      {children}
    </section>
  );
}
