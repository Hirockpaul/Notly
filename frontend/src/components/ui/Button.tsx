import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "icon" | "small";
}

export function Button({
  children,
  className = "",
  variant = "primary",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  const variants = {
    primary: "bg-indigo-400 text-[#0e1020] hover:bg-indigo-300",
    secondary: "border-[#252936] bg-white/4 text-[#f4f5f7] hover:border-[#343948] hover:bg-white/7",
    ghost: "bg-transparent text-[#9298a7] hover:border-[#343948] hover:bg-white/7",
    danger: "border-red-400/20 bg-red-400/10 text-red-300 hover:bg-red-400/20",
  };
  const sizes = {
    default: "min-h-9.5 px-4",
    icon: "size-9.5 p-0",
    small: "min-h-8 px-2.5",
  };
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-[9px] border border-transparent text-xs font-semibold transition duration-150 hover:not-disabled:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${className}`.trim()}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
