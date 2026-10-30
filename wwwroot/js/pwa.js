(() => {
  'use strict';

  const standalone = () => window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  // The service worker is useful only on secure origins; do not hide installation help
  // merely because an installation prompt or Service Worker API is unavailable.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' })
        .catch(error => console.warn('ATLAS PWA: service worker indisponível', error));
    });
  }

  let installPrompt = null;
  let button;
  let dialog;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isSafari = /Safari/i.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);

  const closeHelp = () => { if (dialog) dialog.hidden = true; };

  const showHelp = () => {
    if (!dialog) return;
    const message = dialog.querySelector('[data-install-help]');
    if (isIOS && !isSafari) {
      message.textContent = 'No iPhone ou iPad, abra o ATLAS no Safari. Toque em Compartilhar e selecione Adicionar à Tela de Início.';
    } else if (isIOS) {
      message.textContent = 'No Safari, toque no botão Compartilhar e selecione Adicionar à Tela de Início. Confirme em Adicionar.';
    } else if (isAndroid) {
      message.textContent = 'Abra o menu do navegador (⋮) e selecione Instalar aplicativo ou Adicionar à tela inicial, se disponível.';
    } else {
      message.textContent = 'Abra o menu do navegador e procure Instalar ATLAS ou Instalar aplicativo. A instalação depende do suporte do navegador e de acesso HTTPS.';
    }
    dialog.hidden = false;
    dialog.querySelector('[data-install-close]')?.focus();
  };

  const updateVisibility = () => {
    if (button) { button.hidden = standalone(); button.textContent = installPrompt ? 'Instalar ATLAS' : 'Como instalar ATLAS'; }
    if (standalone()) closeHelp();
  };

  document.addEventListener('DOMContentLoaded', () => {
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'atlasInstallButton';
    button.className = 'atlas-install-button';
    button.textContent = 'Instalar ATLAS';
    button.setAttribute('aria-label', 'Instalar o aplicativo ATLAS');

    dialog = document.createElement('section');
    dialog.className = 'atlas-install-help';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Como instalar o ATLAS');
    const title = document.createElement('strong');
    title.textContent = 'Instalar ATLAS';
    const message = document.createElement('p');
    message.setAttribute('data-install-help', '');
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('data-install-close', '');
    close.textContent = 'Entendi';
    close.addEventListener('click', closeHelp);
    dialog.append(title, message, close);
    document.body.append(button, dialog);

    button.addEventListener('click', async () => {
      if (!installPrompt) {
        showHelp();
        return;
      }
      const prompt = installPrompt;
      installPrompt = null;
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } catch (error) {
        console.warn('ATLAS PWA: prompt não disponível', error);
        showHelp();
      }
    });
    updateVisibility();
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    updateVisibility();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    updateVisibility();
  });
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', updateVisibility);
})();
