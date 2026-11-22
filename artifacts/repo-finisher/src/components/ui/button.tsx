import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none [font-family:var(--ui-display-font)] [text-transform:var(--ui-display-transform)] [letter-spacing:var(--ui-display-tracking)] text-sm font-semibold cursor-pointer transition-[box-shadow,background,transform,color,filter] duration-150 focus-visible:outline focus-visible:outline-[3px] focus-visible:[outline-color:var(--ui-accent-strong)] focus-visible:outline-offset-[3px] focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "[border-width:var(--ui-border-width)] [border-style:solid] [border-color:var(--ui-border-color)] bg-primary text-primary-foreground [box-shadow:var(--ui-shadow-btn)] hover:bg-foreground hover:text-primary-foreground hover:[box-shadow:var(--ui-shadow-btn-hover)] active:translate-x-[2px] active:translate-y-[2px] active:[box-shadow:var(--ui-shadow-btn)]",
        destructive:
          "[border-width:var(--ui-border-width)] [border-style:solid] [border-color:var(--ui-border-color)] bg-destructive text-destructive-foreground [box-shadow:var(--ui-shadow-btn)] hover:bg-foreground hover:text-destructive active:translate-x-[2px] active:translate-y-[2px] active:[box-shadow:var(--ui-shadow-btn)]",
        outline:
          "[border-width:var(--ui-border-width)] [border-style:solid] [border-color:var(--ui-border-color)] bg-background text-foreground [box-shadow:var(--ui-shadow-btn-sm)] hover:bg-foreground hover:text-background active:translate-x-[2px] active:translate-y-[2px] active:[box-shadow:var(--ui-shadow-btn-sm)]",
        secondary:
          "[border-width:var(--ui-border-width)] [border-style:solid] [border-color:var(--ui-border-color)] bg-secondary text-secondary-foreground [box-shadow:var(--ui-shadow-btn-sm)] hover:bg-foreground hover:text-background active:translate-x-[2px] active:translate-y-[2px] active:[box-shadow:var(--ui-shadow-btn-sm)]",
        ghost:
          "[border-width:var(--ui-border-width)] border-transparent text-foreground hover:bg-foreground/10 hover:text-foreground",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2 text-base",
        sm: "h-8 px-3 text-xs",
        lg: "h-14 px-8 text-lg",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
