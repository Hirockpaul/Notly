interface ToggleProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

export function Toggle({ checked, disabled = false, label, onChange }: ToggleProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`relative h-6 w-11 cursor-pointer rounded-full border transition-[background-color,border-color,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B82F6] disabled:cursor-not-allowed disabled:opacity-45 ${checked ? "border-[#3B82F6] bg-[#3B82F6]" : "border-[#4A4A4A] bg-[#2D2D2D] hover:border-[#5A5A5A]"}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={`absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-[left] duration-150 ${checked ? "left-6" : "left-1"}`}
      />
    </button>
  );
}
