import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Remove default padding (for tables/edge-to-edge content). */
  flush?: boolean;
}

/** Surface container: white card on off-white bg, hairline border. */
export function Card({ children, flush, className, ...rest }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface ${flush ? "" : "p-4"} ${className ?? ""}`}
      {...rest}
    >
      {children}
    </div>
  );
}
