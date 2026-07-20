import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white hover:bg-accent-strong",
        secondary: "bg-surface-2 text-text hover:bg-border border border-border",
        ghost: "text-text hover:bg-surface-2",
        outline: "border border-border bg-transparent hover:bg-surface-2",
        danger: "text-danger hover:bg-danger/10 border border-transparent"
      },
      size: {
        sm: "h-8 px-3",
        DEFAULT: "h-9 px-4",
        lg: "h-10 px-5",
        icon: "h-9 w-9"
      }
    },
    defaultVariants: { variant: "primary", size: "DEFAULT" }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";

export { buttonVariants };
