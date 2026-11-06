import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  variant?: "default" | "elevated";
}

export function Card({ children, className = "", variant = "default", ...props }: CardProps) {
  return (
    <section
      className={`rounded-[14px] border border-[#383838] ${variant === "elevated" ? "bg-[#303030]" : "bg-[#292929]"} ${className}`.trim()}
      {...props}
    >
      {children}
    </section>
  );
}
