import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none font-['Anton',Impact,sans-serif] uppercase tracking-[1px] text-sm cursor-pointer transition-[box-shadow,background,transform,color] duration-150 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#9B5CFF] focus-visible:outline-offset-[3px] focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-[3px] border-foreground bg-primary text-primary-foreground shadow-[6px_6px_0_#9B5CFF] hover:bg-foreground hover:text-primary-foreground hover:shadow-[6px_6px_0_#FF4D2E] active:translate-x-[3px] active:translate-y-[3px] active:shadow-[3px_3px_0_#9B5CFF]",
        destructive:
          "border-[3px] border-foreground bg-destructive text-destructive-foreground shadow-[6px_6px_0_#9B5CFF] hover:bg-foreground hover:text-destructive active:translate-x-[3px] active:translate-y-[3px] active:shadow-[3px_3px_0_#9B5CFF]",
        outline:
          "border-[3px] border-foreground bg-background text-foreground shadow-[4px_4px_0_#9B5CFF] hover:bg-foreground hover:text-background active:translate-x-[3px] active:translate-y-[3px] active:shadow-[2px_2px_0_#9B5CFF]",
        secondary:
          "border-[3px] border-foreground bg-secondary text-secondary-foreground shadow-[4px_4px_0_#FF4D2E] hover:bg-foreground hover:text-background active:translate-x-[3px] active:translate-y-[3px] active:shadow-[2px_2px_0_#FF4D2E]",
        ghost:
          "border-[3px] border-transparent text-foreground hover:bg-foreground/10 hover:text-foreground",
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
