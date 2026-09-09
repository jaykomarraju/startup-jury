import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

/**
 * The prototype's primary action is OLIVE (`.tbb.pr{background:var(--olive)}`),
 * not gold — gold is the logo and a few accent numerals. Secondary matches
 * `.tbb`: a surface chip with a stone hairline.
 */
const VARIANTS: Record<Variant, string> = {
  primary: "bg-olive text-white font-medium hover:bg-olive-dk",
  secondary: "bg-surface text-fg-2 border border-line hover:bg-surface-2",
  ghost: "bg-transparent text-fg-muted hover:text-fg hover:bg-surface-2",
};

/** `.tbb` is 11px / 5px 11px; `md` is one step up for form footers. */
const SIZES: Record<Size, string> = {
  sm: "h-[26px] px-[11px] text-ui gap-1",
  md: "h-8 px-3.5 text-item gap-1.5",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-[7px] transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive ${VARIANTS[variant]} ${SIZES[size]} ${className ?? ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}
