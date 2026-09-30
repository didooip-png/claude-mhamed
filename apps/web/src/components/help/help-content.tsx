import {
  type FaqEntry,
  HELP_ROLE_LABELS,
  type HelpRole,
  type HelpTopic,
  parseAnswer,
} from '@pharmastock/shared';
import { AlertTriangle, Lightbulb } from 'lucide-react';
import { Kbd } from '@/components/ui/misc';

/** Réponse de FAQ : paragraphes et listes numérotées. */
export function AnswerView({ answer }: { answer: string[] }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {parseAnswer(answer).map((block, i) =>
        block.type === 'p' ? (
          <p key={i}>{block.text}</p>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

export function FaqItem({ entry }: { entry: FaqEntry }) {
  return (
    <details className="group rounded-md border bg-card px-3 py-2" data-faq={entry.id}>
      <summary className="cursor-pointer list-none text-sm font-medium select-none marker:hidden">
        <span className="mr-1 text-muted-foreground group-open:hidden">▸</span>
        <span className="mr-1 hidden text-muted-foreground group-open:inline">▾</span>
        {entry.question}
      </summary>
      <div className="mt-2 border-t pt-2">
        <AnswerView answer={entry.answer} />
      </div>
    </details>
  );
}

/** Fiche d'un écran : à quoi il sert, étapes numérotées, conseils, mises en garde, raccourcis. */
export function TopicView({ topic, role }: { topic: HelpTopic; role: HelpRole }) {
  const notes = topic.roleNotes?.[role];
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <p>{topic.summary}</p>
      <section>
        <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Pas à pas
        </h3>
        <ol className="list-decimal space-y-1.5 pl-5">
          {topic.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </section>
      {notes && notes.length > 0 && (
        <section className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <h3 className="mb-1 text-xs font-semibold text-primary">
            Pour le rôle {HELP_ROLE_LABELS[role]}
          </h3>
          <ul className="list-disc space-y-1 pl-4">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}
      {topic.tips && topic.tips.length > 0 && (
        <section className="space-y-1.5">
          {topic.tips.map((tip, i) => (
            <p key={i} className="flex gap-2 text-muted-foreground">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <span>{tip}</span>
            </p>
          ))}
        </section>
      )}
      {topic.warnings && topic.warnings.length > 0 && (
        <section className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          {topic.warnings.map((w, i) => (
            <p key={i} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <span>{w}</span>
            </p>
          ))}
        </section>
      )}
      {topic.shortcuts && topic.shortcuts.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Raccourcis clavier
          </h3>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
            {topic.shortcuts.map(([keys, action]) => (
              <div key={keys} className="contents">
                <dt>
                  <Kbd className="text-xs">{keys}</Kbd>
                </dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
