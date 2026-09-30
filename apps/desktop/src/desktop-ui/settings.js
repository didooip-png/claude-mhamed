'use strict';
const $ = (id) => document.getElementById(id);
const api = window.pharmastockSettings;
const message = (text, kind) => {
  $('message').textContent = text ?? '';
  $('message').className = kind ?? '';
};

function fillPrinters(select, printers, current) {
  select.replaceChildren(new Option('— Imprimante par défaut de Windows —', ''));
  for (const name of printers) select.append(new Option(name, name));
  // Une imprimante mémorisée mais absente reste visible (débranchée), plutôt que d'être oubliée en silence.
  if (current && !printers.includes(current))
    select.append(new Option(`${current} (introuvable)`, current));
  select.value = current ?? '';
}

const read = () => ({
  serverUrl: $('serverUrl').value,
  ticketPrinter: $('ticketPrinter').value,
  a4Printer: $('a4Printer').value,
  fullscreen: $('fullscreen').checked,
  autoStart: $('autoStart').checked,
});

async function busy(button, fn) {
  button.disabled = true;
  message('');
  try {
    await fn();
  } catch (e) {
    message(
      e instanceof Error
        ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        : String(e),
      'error',
    );
  } finally {
    button.disabled = false;
  }
}

(async () => {
  const state = await api.get();
  $('serverUrl').value = state.settings.serverUrl;
  fillPrinters($('ticketPrinter'), state.printers, state.settings.ticketPrinter);
  fillPrinters($('a4Printer'), state.printers, state.settings.a4Printer);
  $('fullscreen').checked = state.settings.fullscreen;
  $('autoStart').checked = state.settings.autoStart;
  $('version').textContent = state.version;
  $('intro').hidden = !state.firstRun;
  if (state.firstRun) $('cancel').textContent = 'Quitter';

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    void busy($('save'), async () => {
      await api.save(read());
      await api.close();
    });
  });
  $('cancel').addEventListener('click', () => void api.close());
  $('testTicket').addEventListener(
    'click',
    () =>
      void busy($('testTicket'), async () => {
        await api.testPrint(read(), 'TICKET');
        message('Ticket de test envoyé à l’imprimante.', 'ok');
      }),
  );
  $('testA4').addEventListener(
    'click',
    () =>
      void busy($('testA4'), async () => {
        await api.testPrint(read(), 'A4');
        message('Page de test envoyée à l’imprimante.', 'ok');
      }),
  );
  $('testDrawer').addEventListener(
    'click',
    () =>
      void busy($('testDrawer'), async () => {
        await api.testDrawer(read());
        message('Impulsion envoyée : le tiroir doit s’ouvrir.', 'ok');
      }),
  );
})();
