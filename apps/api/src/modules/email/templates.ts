/**
 * Modèles d'e-mails par défaut (§6.19 D), en français, ton professionnel.
 * Variables : {{client.nom}}, {{document.numero}}, {{document.date}}, {{document.montant}},
 * {{document.reste_a_payer}}, {{etablissement.nom}}, {{etablissement.telephone}},
 * {{etablissement.adresse}}, {{etablissement.email}}, {{message}}, {{lien}}…
 *
 * Confidentialité : le corps des e-mails envoyés aux clients ne cite AUCUN nom de médicament ;
 * le détail n'est que dans le PDF joint.
 */

export interface EmailTemplateDefinition {
  key: string;
  label: string;
  audience: 'CLIENT' | 'STAFF' | 'SYSTEM' | 'SUPPLIER';
  subject: string;
  /** Contenu principal (fragment MJML inséré dans la mise en page commune). */
  body: string;
  text: string;
  variables: string[];
}

const CLIENT_FOOTER_TEXT = `\n—\n{{etablissement.nom}} · {{etablissement.adresse}} · {{etablissement.telephone}}\nVous recevez ce document car vous avez accepté de recevoir vos documents par e-mail. Pour ne plus les recevoir, répondez à ce message ou contactez-nous.`;

const DOC_VARS = [
  'client.nom',
  'document.numero',
  'document.date',
  'document.montant',
  'document.reste_a_payer',
  'message',
  'etablissement.nom',
  'etablissement.telephone',
  'etablissement.adresse',
  'etablissement.email',
];

export const DEFAULT_TEMPLATES: EmailTemplateDefinition[] = [
  {
    key: 'INVOICE',
    label: 'Facture',
    audience: 'CLIENT',
    subject: 'Facture {{document.numero}} — {{etablissement.nom}}',
    body: `<mj-text>Bonjour {{client.nom}},</mj-text>
<mj-text>Veuillez trouver ci-joint votre facture <strong>{{document.numero}}</strong> du {{document.date}}, d’un montant de <strong>{{document.montant}}</strong>.</mj-text>
<mj-text>Reste à payer : <strong>{{document.reste_a_payer}}</strong>.</mj-text>
<mj-text>{{message}}</mj-text>
<mj-text>Merci de votre confiance.<br/>{{etablissement.nom}}</mj-text>`,
    text: `Bonjour {{client.nom}},\n\nVeuillez trouver ci-joint votre facture {{document.numero}} du {{document.date}}, d’un montant de {{document.montant}}.\nReste à payer : {{document.reste_a_payer}}.\n\n{{message}}\n\nMerci de votre confiance.\n{{etablissement.nom}}${CLIENT_FOOTER_TEXT}`,
    variables: DOC_VARS,
  },
  {
    key: 'INVOICE_CANCELLED',
    label: 'Facture annulée / remplacée',
    audience: 'CLIENT',
    subject: 'Facture {{document.numero}} annulée — {{etablissement.nom}}',
    body: `<mj-text>Bonjour {{client.nom}},</mj-text>
<mj-text>Nous vous informons que la facture <strong>{{document.numero}}</strong> du {{document.date}} ({{document.montant}}) a été <strong>annulée</strong>. Le document annulé est joint pour vos archives.</mj-text>
<mj-text>{{message}}</mj-text>
<mj-text>Cordialement,<br/>{{etablissement.nom}}</mj-text>`,
    text: `Bonjour {{client.nom}},\n\nNous vous informons que la facture {{document.numero}} du {{document.date}} ({{document.montant}}) a été annulée. Le document annulé est joint pour vos archives.\n\n{{message}}\n\nCordialement,\n{{etablissement.nom}}${CLIENT_FOOTER_TEXT}`,
    variables: DOC_VARS,
  },
  {
    key: 'CREDIT_NOTE',
    label: 'Avoir',
    audience: 'CLIENT',
    subject: 'Avoir {{document.numero}} — {{etablissement.nom}}',
    body: `<mj-text>Bonjour {{client.nom}},</mj-text>
<mj-text>Suite à votre retour, un avoir <strong>{{document.numero}}</strong> de <strong>{{document.montant}}</strong> a été émis le {{document.date}}. Il est utilisable pour vos prochains achats.</mj-text>
<mj-text>{{message}}</mj-text>
<mj-text>Cordialement,<br/>{{etablissement.nom}}</mj-text>`,
    text: `Bonjour {{client.nom}},\n\nSuite à votre retour, un avoir {{document.numero}} de {{document.montant}} a été émis le {{document.date}}. Il est utilisable pour vos prochains achats.\n\n{{message}}\n\nCordialement,\n{{etablissement.nom}}${CLIENT_FOOTER_TEXT}`,
    variables: DOC_VARS,
  },
  {
    key: 'PAYMENT_RECEIPT',
    label: 'Reçu de règlement',
    audience: 'CLIENT',
    subject: 'Reçu de règlement {{document.numero}} — {{etablissement.nom}}',
    body: `<mj-text>Bonjour {{client.nom}},</mj-text>
<mj-text>Nous accusons réception de votre règlement <strong>{{document.numero}}</strong> du {{document.date}} d’un montant de <strong>{{document.montant}}</strong>. Le reçu est joint.</mj-text>
<mj-text>{{message}}</mj-text>
<mj-text>Merci,<br/>{{etablissement.nom}}</mj-text>`,
    text: `Bonjour {{client.nom}},\n\nNous accusons réception de votre règlement {{document.numero}} du {{document.date}} d’un montant de {{document.montant}}. Le reçu est joint.\n\n{{message}}\n\nMerci,\n{{etablissement.nom}}${CLIENT_FOOTER_TEXT}`,
    variables: DOC_VARS,
  },
  {
    key: 'STATEMENT',
    label: 'Relevé de compte',
    audience: 'CLIENT',
    subject: 'Relevé de compte — {{etablissement.nom}}',
    body: `<mj-text>Bonjour {{client.nom}},</mj-text>
<mj-text>Veuillez trouver ci-joint votre relevé de compte arrêté au {{document.date}}. Solde : <strong>{{document.montant}}</strong>.</mj-text>
<mj-text>{{message}}</mj-text>
<mj-text>Cordialement,<br/>{{etablissement.nom}}</mj-text>`,
    text: `Bonjour {{client.nom}},\n\nVeuillez trouver ci-joint votre relevé de compte arrêté au {{document.date}}. Solde : {{document.montant}}.\n\n{{message}}\n\nCordialement,\n{{etablissement.nom}}${CLIENT_FOOTER_TEXT}`,
    variables: DOC_VARS,
  },
  ...[1, 2, 3].map((n) => ({
    key: `DUNNING_${n}`,
    label: `Relance de facture échue (${n})`,
    audience: 'CLIENT' as const,
    subject:
      n === 1
        ? 'Rappel : facture {{document.numero}} — {{etablissement.nom}}'
        : n === 2
          ? 'Deuxième rappel : facture {{document.numero}}'
          : 'Dernier rappel avant contentieux : facture {{document.numero}}',
    body: `<mj-text>Bonjour {{client.nom}},</mj-text>
<mj-text>${
      n === 1
        ? 'Sauf erreur de notre part, la facture <strong>{{document.numero}}</strong> du {{document.date}} présente un reste à payer de <strong>{{document.reste_a_payer}}</strong>, arrivé à échéance.'
        : n === 2
          ? 'Malgré notre précédent rappel, la facture <strong>{{document.numero}}</strong> du {{document.date}} reste impayée à hauteur de <strong>{{document.reste_a_payer}}</strong>. Merci de régulariser rapidement.'
          : 'La facture <strong>{{document.numero}}</strong> du {{document.date}} demeure impayée (<strong>{{document.reste_a_payer}}</strong>). Sans règlement de votre part, nous serons contraints d’engager une procédure de recouvrement.'
    }</mj-text>
<mj-text>Si vous avez déjà effectué ce règlement, merci de ne pas tenir compte de ce message.</mj-text>
<mj-text>Cordialement,<br/>{{etablissement.nom}}</mj-text>`,
    text: `Bonjour {{client.nom}},\n\nLa facture {{document.numero}} du {{document.date}} présente un reste à payer de {{document.reste_a_payer}}, arrivé à échéance.\nSi vous avez déjà effectué ce règlement, merci de ne pas tenir compte de ce message.\n\nCordialement,\n{{etablissement.nom}}${CLIENT_FOOTER_TEXT}`,
    variables: DOC_VARS,
  })),
  {
    key: 'PURCHASE_ORDER',
    label: 'Bon de commande fournisseur',
    audience: 'SUPPLIER',
    subject: 'Bon de commande {{document.numero}} — {{etablissement.nom}}',
    body: `<mj-text>Bonjour,</mj-text>
<mj-text>Veuillez trouver ci-joint notre bon de commande <strong>{{document.numero}}</strong> du {{document.date}} (montant estimé : {{document.montant}}).</mj-text>
<mj-text>{{message}}</mj-text>
<mj-text>Merci de nous confirmer la disponibilité et le délai de livraison.</mj-text>
<mj-text>Cordialement,<br/>{{etablissement.nom}}<br/>{{etablissement.telephone}}</mj-text>`,
    text: `Bonjour,\n\nVeuillez trouver ci-joint notre bon de commande {{document.numero}} du {{document.date}} (montant estimé : {{document.montant}}).\n\n{{message}}\n\nMerci de nous confirmer la disponibilité et le délai de livraison.\n\nCordialement,\n{{etablissement.nom}}\n{{etablissement.telephone}}`,
    variables: DOC_VARS,
  },
  {
    key: 'ADMIN_NOTIFICATION',
    label: 'Notification administrateur',
    audience: 'STAFF',
    subject: '[{{etablissement.nom}}] {{notification.titre}}',
    body: `<mj-text font-size="16px"><strong>{{notification.titre}}</strong></mj-text>
<mj-text>{{notification.detail}}</mj-text>
<mj-text>Par : {{notification.utilisateur}} · {{notification.date}}</mj-text>
<mj-button href="{{lien}}">Ouvrir dans PharmaStock</mj-button>
<mj-text font-size="12px" color="#666666"><a href="{{lien_notifications}}">Gérer mes notifications</a></mj-text>`,
    text: `{{notification.titre}}\n\n{{notification.detail}}\nPar : {{notification.utilisateur}} · {{notification.date}}\n\nOuvrir : {{lien}}\nGérer mes notifications : {{lien_notifications}}`,
    variables: [
      'notification.titre',
      'notification.detail',
      'notification.utilisateur',
      'notification.date',
      'lien',
      'lien_notifications',
      'etablissement.nom',
    ],
  },
  {
    key: 'DIGEST',
    label: 'Résumé quotidien / hebdomadaire',
    audience: 'STAFF',
    subject: '[{{etablissement.nom}}] {{resume.titre}}',
    body: `<mj-text font-size="16px"><strong>{{resume.titre}}</strong></mj-text>
<mj-text>{{resume.contenu}}</mj-text>
<mj-button href="{{lien}}">Ouvrir PharmaStock</mj-button>
<mj-text font-size="12px" color="#666666"><a href="{{lien_notifications}}">Gérer mes notifications</a></mj-text>`,
    text: `{{resume.titre}}\n\n{{resume.texte}}\n\n{{lien}}\nGérer mes notifications : {{lien_notifications}}`,
    variables: [
      'resume.titre',
      'resume.contenu',
      'resume.texte',
      'lien',
      'lien_notifications',
      'etablissement.nom',
    ],
  },
  {
    key: 'TEST',
    label: 'E-mail de test',
    audience: 'SYSTEM',
    subject: 'E-mail de test — {{etablissement.nom}}',
    body: `<mj-text>Bonjour,</mj-text>
<mj-text>Cet e-mail confirme que la configuration SMTP de <strong>{{etablissement.nom}}</strong> fonctionne correctement.</mj-text>
<mj-text>Envoyé par {{utilisateur}} le {{date}}.</mj-text>`,
    text: `Bonjour,\n\nCet e-mail confirme que la configuration SMTP de {{etablissement.nom}} fonctionne correctement.\nEnvoyé par {{utilisateur}} le {{date}}.`,
    variables: ['etablissement.nom', 'utilisateur', 'date'],
  },
];

/** Mise en page commune (logo, couleur de l'établissement, pied de page). */
export function wrapLayout(
  inner: string,
  options: {
    color: string;
    audience: 'CLIENT' | 'STAFF' | 'SYSTEM' | 'SUPPLIER';
    logoUrl: string | null;
  },
): string {
  const footer =
    options.audience === 'SUPPLIER'
      ? `<mj-text font-size="11px" color="#777777" align="center">{{etablissement.nom}} · {{etablissement.adresse}} · {{etablissement.telephone}}</mj-text>`
      : options.audience === 'CLIENT'
        ? `<mj-text font-size="11px" color="#777777" align="center">{{etablissement.nom}} · {{etablissement.adresse}} · {{etablissement.telephone}}<br/>Vous recevez ce document car vous avez accepté de recevoir vos documents par e-mail. Pour ne plus les recevoir, répondez simplement à ce message ou contactez-nous.</mj-text>`
        : `<mj-text font-size="11px" color="#777777" align="center">Message automatique de PharmaStock — {{etablissement.nom}}</mj-text>`;
  return `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-text font-size="14px" line-height="1.5" color="#1f2937" />
      <mj-button background-color="${options.color}" color="#ffffff" border-radius="6px" font-weight="bold" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f3f4f6">
    <mj-section background-color="${options.color}" padding="16px">
      <mj-column>
        ${options.logoUrl ? `<mj-image src="${options.logoUrl}" alt="{{etablissement.nom}}" width="120px" padding="0" />` : `<mj-text color="#ffffff" font-size="18px" font-weight="bold">{{etablissement.nom}}</mj-text>`}
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="20px 16px">
      <mj-column>
${inner}
      </mj-column>
    </mj-section>
    <mj-section padding="12px">
      <mj-column>${footer}</mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}
