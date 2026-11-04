import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  variant?: "default" | "elevated";
}

export function Card({ children, className = "", variant = "default", ...props }: CardProps) {
  return (
    <section
      className={`rounded-[18px] border border-[#252936] shadow-[0_18px_45px_rgb(0_0_0/18%)] ${variant === "elevated" ? "bg-[#1a1d27]" : "bg-[#14161d]"} ${className}`.trim()}
      {...props}
    >
      {children}
    </section>
  );
}
