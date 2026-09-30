import {
  CHEAT_SHEET,
  CHEAT_SHEET_SUBTITLE,
  CHEAT_SHEET_TITLE,
  HELP_ROLE_LABELS,
  type HelpRole,
  faqFor,
  manualFor,
  topicForPath,
} from '@pharmastock/shared';
import { useQuery } from '@tanstack/react-query';
import { Compass, Download, FileText, Printer, Search } from 'lucide-react';
import * as React from 'react';
import { FaqItem, TopicView } from '@/components/help/help-content';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { startTour, useHelpRole } from '@/lib/help';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const MANUALS: { file: string; title: string; description: string; roles: HelpRole[] }[] = [
  {
    file: 'PharmaStock-Manuel-Administrateur.pdf',
    title: 'Manuel de l’administrateur',
    description:
      'Toutes les procédures, avec captures d’écran : caisse, stock, achats, rapports, administration.',
    roles: ['ADMIN'],
  },
  {
    file: 'PharmaStock-Manuel-Preparateur.pdf',
    title: 'Manuel du préparateur',
    description:
      'Vendre, encaisser, faire un retour, réceptionner, compter le stock et clôturer la caisse.',
    roles: ['ADMIN', 'PREPARER'],
  },
  {
    file: 'PharmaStock-Aide-memoire-Preparateur.pdf',
    title: 'Aide-mémoire du préparateur (1 page)',
    description: 'À imprimer et poser à côté du poste : raccourcis de caisse, vente, retour.',
    roles: ['ADMIN', 'PREPARER'],
  },
];

const GENERAL_KEYS: [string, string][] = [
  ['F1', 'Aide de l’écran affiché (à la caisse : raccourcis de la caisse)'],
  ['Ctrl K', 'Recherche partout : produits, clients, ventes, écrans'],
  ['F12', 'Ouvrir la caisse'],
  ['Échap', 'Fermer la fenêtre ou la liste ouverte'],
];

/** Page Aide : FAQ « Que faire si… », guide par écran, raccourcis, fiche mémo et manuels PDF. */
export function HelpPage() {
  const ownRole = useHelpRole();
  const [role, setRole] = React.useState<HelpRole>(ownRole);
  const [query, setQuery] = React.useState('');
  const isAdmin = ownRole === 'ADMIN';

  const faq = React.useMemo(() => {
    const q = normalize(query.trim());
    return faqFor(role).filter(
      (f) => !q || normalize([f.question, ...f.answer].join(' ')).includes(q),
    );
  }, [role, query]);
  const manual = React.useMemo(() => manualFor(role), [role]);
  const posKeys = topicForPath('/pos', role)?.shortcuts ?? [];

  return (
    <>
      <PageHeader
        title="Aide"
        description="Procédures pas à pas, questions fréquentes, raccourcis et documents à imprimer."
        actions={
          <>
            {isAdmin && (
              <div
                className="flex overflow-hidden rounded-md border"
                role="group"
                aria-label="Aide pour le rôle"
              >
                {(['ADMIN', 'PREPARER'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    aria-pressed={role === r}
                    className={`cursor-pointer px-3 py-1.5 text-sm ${role === r ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}
                  >
                    {HELP_ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
            )}
            <Button variant="outline" onClick={startTour}>
              <Compass /> Visite guidée
            </Button>
          </>
        }
      />
      <Tabs defaultValue="faq">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="faq">Que faire si…</TabsTrigger>
          <TabsTrigger value="guide">Guide par écran</TabsTrigger>
          <TabsTrigger value="keys">Raccourcis</TabsTrigger>
          <TabsTrigger value="memo">Fiche mémo</TabsTrigger>
          <TabsTrigger value="manuals">Manuels PDF</TabsTrigger>
        </TabsList>

        <TabsContent value="faq" className="space-y-3">
          <div className="relative max-w-lg">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Décrivez le problème : stock, e-mail, PIN…"
              aria-label="Rechercher dans la FAQ"
              className="pl-8"
            />
          </div>
          {faq.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune réponse ne correspond. Essayez un mot plus court ou demandez à un
              administrateur.
            </p>
          ) : (
            <div className="space-y-2">
              {faq.map((f) => (
                <FaqItem key={f.id} entry={f} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="guide" className="space-y-6">
          {manual.map(({ chapter, topics }) => (
            <section key={chapter.id} className="space-y-2">
              <h2 className="text-lg font-semibold">{chapter.title}</h2>
              <p className="text-sm text-muted-foreground">
                {chapter.intro[role] ?? chapter.intro.default}
              </p>
              {topics.map((t) => (
                <details
                  key={t.id}
                  className="group rounded-md border bg-card px-3 py-2"
                  data-topic={t.id}
                >
                  <summary className="cursor-pointer list-none text-sm font-medium select-none marker:hidden">
                    <span className="mr-1 text-muted-foreground group-open:hidden">▸</span>
                    <span className="mr-1 hidden text-muted-foreground group-open:inline">▾</span>
                    {t.title}
                  </summary>
                  <div className="mt-2 border-t pt-3">
                    <TopicView topic={t} role={role} />
                  </div>
                </details>
              ))}
            </section>
          ))}
        </TabsContent>

        <TabsContent value="keys" className="grid gap-4 md:grid-cols-2">
          <KeyTable title="Partout dans le logiciel" rows={GENERAL_KEYS} />
          <KeyTable title="À la caisse" rows={posKeys} />
        </TabsContent>

        <TabsContent value="memo" className="space-y-3">
          <div className="flex justify-end print:hidden">
            <Button onClick={() => window.print()}>
              <Printer /> Imprimer la fiche
            </Button>
          </div>
          <CheatSheet />
        </TabsContent>

        <TabsContent value="manuals" className="grid gap-3 md:grid-cols-2">
          {MANUALS.filter((m) => m.roles.includes(ownRole)).map((m) => (
            <ManualCard key={m.file} {...m} />
          ))}
        </TabsContent>
      </Tabs>
    </>
  );
}

function KeyTable({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <dl className="grid grid-cols-[6rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
        {rows.map(([keys, action]) => (
          <div key={keys} className="contents">
            <dt>
              <Kbd className="text-xs">{keys}</Kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Fiche mémo à l'écran ; la même mise en page sert à l'impression (A4). */
function CheatSheet() {
  return (
    <article
      className="rounded-lg border bg-card p-5 print:border-0 print:p-0"
      data-testid="cheat-sheet"
    >
      <header className="mb-4 border-b pb-3">
        <h2 className="text-xl font-semibold">{CHEAT_SHEET_TITLE}</h2>
        <p className="text-sm text-muted-foreground">{CHEAT_SHEET_SUBTITLE}</p>
      </header>
      <div className="columns-1 gap-8 md:columns-2 print:columns-2">
        {CHEAT_SHEET.map((block) => (
          <section key={block.title} className="mb-5 break-inside-avoid">
            <h3 className="mb-1.5 text-sm font-semibold text-primary">{block.title}</h3>
            {block.kind === 'keys' ? (
              <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-sm">
                {(block.items as [string, string][]).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt>
                      <Kbd className="text-xs">{k}</Kbd>
                    </dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            ) : block.kind === 'steps' ? (
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {(block.items as string[]).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {(block.items as string[]).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </article>
  );
}

/** Carte d'un manuel PDF : le lien n'est proposé que si le fichier a bien été généré. */
function ManualCard({
  file,
  title,
  description,
}: {
  file: string;
  title: string;
  description: string;
}) {
  const url = `/manuels/${file}`;
  const available = useQuery({
    queryKey: ['manual-available', file],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        return res.ok && (res.headers.get('content-type') ?? '').includes('pdf');
      } catch {
        return false;
      }
    },
  });
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
      <FileText className="mt-0.5 size-8 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        {available.data ? (
          <Button size="sm" className="mt-3" asChild>
            <a href={url} download>
              <Download /> Télécharger le PDF
            </a>
          </Button>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            {available.isPending
              ? 'Vérification…'
              : 'Ce document n’est pas encore installé sur ce serveur.'}
          </p>
        )}
      </div>
    </div>
  );
}
