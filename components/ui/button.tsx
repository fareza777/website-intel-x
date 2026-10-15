import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[18px]", { variants: { variant: { default: "bg-[#4788ff] text-white hover:bg-[#659bff]", outline: "border border-white/12 bg-white/[0.025] text-[#c5cad6] hover:bg-white/[0.07]", ghost: "text-[#a2acbe] hover:bg-white/[0.06] hover:text-white" }, size: { default: "h-11 px-4", sm: "h-9 px-3", icon: "size-11" } }, defaultVariants: { variant: "default", size: "default" } });
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) { const Comp = asChild ? Slot : "button"; return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />; }
