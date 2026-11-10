interface NotoLogoProps {
  className?: string;
  size?: number;
}

export function NotoLogo({ className, size = 32 }: NotoLogoProps) {
  return (
    <svg aria-hidden="true" className={className} height={size} viewBox="0 0 32 32" width={size}>
      <rect fill="#343434" height="32" rx="9.5" width="32" />
      <rect fill="#F5F5F5" height="8" rx="1.4" width="2.8" x="6.4" y="12" />
      <rect fill="#F5F5F5" height="14" rx="1.4" width="2.8" x="11.1" y="9" />
      <rect fill="#3B82F6" height="20" rx="1.4" width="2.8" x="14.6" y="6" />
      <rect fill="#F5F5F5" height="14" rx="1.4" width="2.8" x="18.1" y="9" />
      <rect fill="#F5F5F5" height="8" rx="1.4" width="2.8" x="22.8" y="12" />
    </svg>
  );
}
