(() => {
  'use strict';
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' })
      .catch(error => console.warn('ATLAS PWA: service worker indisponível', error));
  });

  let installPrompt = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'atlasInstallButton';
  button.className = 'atlas-install-button';
  button.textContent = 'Instalar ATLAS';
  button.hidden = true;
  button.setAttribute('aria-label', 'Instalar o aplicativo ATLAS');
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(button);
  });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    if (!standalone()) button.hidden = false;
  });
  button.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    button.hidden = true;
    await prompt.prompt();
    await prompt.userChoice;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    button.hidden = true;
  });
})();
