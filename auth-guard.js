/**
 * ANFEER — acesso às páginas internas.
 * A tela de inspeção (/anfeer/inspecao/) permanece pública e NÃO inclui este guard.
 *
 * OBS: em GitHub Pages (hospedagem estática), esta barreira evita a exibição
 * e a execução normal do app sem login. O bloqueio HTTP da entrega do HTML
 * requer uma camada de autenticação na hospedagem/proxy.
 */
(function () {
  'use strict';
  document.documentElement.style.visibility = 'hidden';
  const PORTAL = '../';
  const API = 'https://anfeer-inspecao-api.apicolumbia.workers.dev/';
  const token = localStorage.getItem('anfeer_portal_token');

  function redirect() {
    localStorage.removeItem('anfeer_portal_token');
    localStorage.removeItem('anfeer_user');
    // Ao acessar uma tela diretamente, redirecionar para a identificação.
    window.location.replace(PORTAL);
    return false;
  }

  // Revalidar ao retornar pelo botão Voltar e ao sair em outra aba.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
      document.documentElement.style.visibility = 'hidden';
      window.location.reload();
    }
  });
  window.addEventListener('storage', function (event) {
    if (event.key === 'anfeer_portal_token' && !event.newValue) {
      document.documentElement.style.visibility = 'hidden';
      redirect();
    }
  });

  window.anfeerAuthReady = (async function () {
    if (!token) return redirect();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const result = await fetch(API + '?action=portal_session', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal
      });
      if (!result.ok) return redirect();
      const data = await result.json();
      if (!data.ok) return redirect();
      document.documentElement.style.visibility = 'visible';
      document.dispatchEvent(new Event('anfeer:authorized'));
      return true;
    } catch (error) {
      return redirect();
    } finally {
      clearTimeout(timer);
    }
  })();
})();
