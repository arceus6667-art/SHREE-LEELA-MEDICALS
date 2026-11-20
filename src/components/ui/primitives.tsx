import * as React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { cva, type VariantProps } from 'class-variance-authority';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D71920] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 min-h-[40px] cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-[#D71920] text-white hover:bg-[#B5121B]',
        secondary: 'bg-[#16835D] text-white hover:bg-[#126B4C]',
        outline: 'border border-[#E1E5EB] bg-white text-[#202630] hover:bg-[#F5F7FA]',
        ghost: 'text-[#202630] hover:bg-[#F5F7FA]',
        destructive: 'bg-[#B5121B] text-white hover:bg-[#910E15]',
      },
      size: {
        default: 'px-4 py-2',
        sm: 'px-3 py-1.5 text-xs min-h-[36px]',
        lg: 'px-6 py-2.5 text-base min-h-[44px]',
        icon: 'h-10 w-10 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  }
);
Button.displayName = 'Button';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-[#E1E5EB] bg-white text-[#202630]', className)}
      {...props}
    />
  )
);
Card.displayName = 'Card';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-[#E1E5EB] bg-white px-3 py-2 text-sm text-[#202630] placeholder:text-[#6B7686] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D71920] disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[84px] w-full rounded-md border border-[#E1E5EB] bg-white px-3 py-2 text-sm text-[#202630] placeholder:text-[#6B7686] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D71920] disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-[#E1E5EB] bg-white px-3 py-2 text-sm text-[#202630] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D71920]',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = 'Select';

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('block text-xs font-medium text-[#3C4654] mb-1.5', className)}
      {...props}
    />
  )
);
Label.displayName = 'Label';

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-left text-sm', className)} {...props} />
    </div>
  );
}
