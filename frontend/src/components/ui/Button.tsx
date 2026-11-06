import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
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
    primary: "bg-[#F5F5F5] text-[#171717] hover:bg-white",
    secondary: "border-[#383838] bg-[#343434] text-[#F5F5F5] hover:bg-[#3A3A3A]",
    ghost: "bg-transparent text-[#A3A3A3] hover:bg-[#3A3A3A] hover:text-[#F5F5F5]",
    danger: "border-[#EF4444]/30 bg-transparent text-[#EF4444] hover:bg-[#EF4444]/10",
    accent:
      "border-white/70 bg-[linear-gradient(180deg,#F7F7F7_0%,#E5E5E5_48%,#B9B9B9_100%)] text-[#1F1F1F] shadow-[inset_0_1px_0_rgb(255_255_255/90%),inset_0_-1px_0_rgb(0_0_0/10%),0_3px_7px_rgb(0_0_0/28%)] hover:brightness-105",
  };
  const sizes = {
    default: "min-h-9.5 px-4",
    icon: "size-9.5 p-0",
    small: "min-h-8 px-2.5",
  };
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-transparent text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B82F6] disabled:cursor-not-allowed disabled:text-[#555555] disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`.trim()}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
