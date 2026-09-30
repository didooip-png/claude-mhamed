import { parseMoney, parsePercentToBp, toMoneyInput } from '@pharmastock/shared';
import * as React from 'react';
import { HelpTip } from '@/components/help/help-tip';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function FormField({
  label,
  error,
  hint,
  help,
  required,
  className,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  hint?: React.ReactNode;
  /** Bulle d'aide « ? » à côté du libellé, pour les champs difficiles. */
  help?: React.ReactNode;
  required?: boolean;
  className?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  // Le libellé est relié au champ (clic, lecteurs d'écran) même sans identifiant explicite.
  const autoId = React.useId();
  const id = htmlFor ?? autoId;
  const field =
    React.isValidElement<{ id?: string }>(children) && !children.props.id
      ? React.cloneElement(children, { id })
      : children;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {help ? (
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>
            {label}
            {required && <span className="ml-0.5 text-destructive">*</span>}
          </Label>
          <HelpTip label={`Aide : ${label}`}>{help}</HelpTip>
        </div>
      ) : (
        <Label htmlFor={id}>
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
      )}
      {field}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Saisie d'un montant (affiché en dinars, stocké en millimes). */
export const MoneyInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
    value: number | null | undefined;
    onValueChange: (v: number | null) => void;
  }
>(({ value, onValueChange, className, ...props }, ref) => {
  const [text, setText] = React.useState(
    value === null || value === undefined ? '' : toMoneyInput(value),
  );
  const last = React.useRef(value);
  React.useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      const parsed = parseMoney(text);
      if (parsed !== value)
        setText(value === null || value === undefined ? '' : toMoneyInput(value));
    }
  }, [value, text]);
  return (
    <div className="relative">
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        className={cn('pr-9 text-right tabular', className)}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = e.target.value.trim() === '' ? null : parseMoney(e.target.value);
          if (parsed !== null || e.target.value.trim() === '') {
            last.current = parsed;
            onValueChange(parsed);
          }
        }}
        onBlur={(e) => {
          const parsed = parseMoney(text);
          if (parsed !== null) setText(toMoneyInput(parsed));
          props.onBlur?.(e);
        }}
        {...props}
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
        DT
      </span>
    </div>
  );
});
MoneyInput.displayName = 'MoneyInput';

/** Saisie d'un pourcentage (stocké en points de base). */
export const PercentInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
    value: number;
    onValueChange: (bp: number) => void;
  }
>(({ value, onValueChange, className, ...props }, ref) => {
  const [text, setText] = React.useState(String(value / 100).replace('.', ','));
  React.useEffect(() => {
    if (parsePercentToBp(text) !== value) setText(String(value / 100).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <Input
        ref={ref}
        inputMode="decimal"
        className={cn('pr-7 text-right tabular', className)}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const bp = parsePercentToBp(e.target.value || '0');
          if (bp !== null && bp <= 10000) onValueChange(bp);
        }}
        {...props}
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
        %
      </span>
    </div>
  );
});
PercentInput.displayName = 'PercentInput';
