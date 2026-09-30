import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

/** Codes couleur constants (§10) : rouge = critique, orange = avertissement, jaune = attention, vert = OK. */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        red: 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
        orange:
          'border-transparent bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
        yellow:
          'border-transparent bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200',
        green:
          'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
        blue: 'border-transparent bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
        gray: 'border-transparent bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
