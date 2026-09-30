import { CircleHelp } from 'lucide-react';
import * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Bulle d'aide à côté d'un champ difficile. Se touche (téléphone) autant qu'elle se survole ;
 * `data-dense` la garde compacte, une zone tactile élargie la rend facile à atteindre.
 */
export function HelpTip({
  children,
  label = 'Aide sur ce champ',
  className,
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-dense
          aria-label={label}
          className={cn(
            "relative inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none before:absolute before:-inset-2.5 before:content-['']",
            className,
          )}
        >
          <CircleHelp className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-xs leading-relaxed" align="start">
        {children}
      </PopoverContent>
    </Popover>
  );
}
