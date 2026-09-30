import { Mail } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import { api, errorText } from '@/lib/api';

const split = (v: string) =>
  v
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Envoyer / renvoyer un document au client par e-mail (§6.19 C) : destinataire, copie et message
 * modifiables ; sans consentement du client, une confirmation explicite est exigée.
 */
export function SendEmailDialog({
  title,
  endpoint,
  client,
  extraBody,
  recipientsKey = 'to',
  onClose,
  onDone,
}: {
  title: string;
  endpoint: string;
  client: { email: string | null; emailConsent: boolean } | null;
  /** Champs supplémentaires du corps (ex. période d'un relevé). */
  extraBody?: Record<string, unknown>;
  /** Nom du champ des destinataires dans le corps ('to' ou 'recipients'). */
  recipientsKey?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [to, setTo] = React.useState(client?.email ?? '');
  const [cc, setCc] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const consent = !!client?.emailConsent;

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(endpoint, {
        ...extraBody,
        [recipientsKey]: split(to),
        cc: split(cc),
        message: message.trim() || null,
        confirmNoConsent: confirm,
      });
      toast.success('E-mail mis en file d’envoi.');
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Le PDF est joint ; le corps de l’e-mail ne mentionne aucun médicament.
          </DialogDescription>
        </DialogHeader>
        <FormField label="Destinataire(s)" required>
          <Input value={to} onChange={(e) => setTo(e.target.value)} aria-label="Destinataires" />
        </FormField>
        <FormField label="Copie" hint="Séparez plusieurs adresses par une virgule.">
          <Input value={cc} onChange={(e) => setCc(e.target.value)} aria-label="Copie" />
        </FormField>
        <FormField label="Message (facultatif)">
          <Textarea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            aria-label="Message"
          />
        </FormField>
        {!consent && (
          <label className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-sm dark:bg-amber-950/40">
            <Checkbox
              checked={confirm}
              onCheckedChange={(v) => setConfirm(v === true)}
              className="mt-0.5"
            />
            Ce client n’a pas donné son consentement à l’envoi par e-mail. Je confirme l’envoi à sa
            demande.
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={split(to).length === 0 || (!consent && !confirm)}
            onClick={() => void submit()}
          >
            <Mail /> Envoyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
