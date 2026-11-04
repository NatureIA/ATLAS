(() => {
  'use strict';
  const section=document.getElementById('atlasPushSettings');
  if(!section)return;
  const button=document.getElementById('atlasPushToggle');
  const status=document.getElementById('atlasPushStatus');
  const token=section.querySelector('input[name="__RequestVerificationToken"]')?.value;
  const supported=window.isSecureContext && 'serviceWorker' in navigator &&
    'PushManager' in window && 'Notification' in window;

  const message=value=>{if(status)status.textContent=value;};
  const updateButton=enabled=>{
    button.hidden=false;
    button.disabled=false;
    button.querySelector('.theme-toggle-text').textContent=enabled
      ? 'Desativar notificações':'Ativar notificações';
    button.setAttribute('aria-label',enabled?'Desativar notificações':'Ativar notificações');
    button.setAttribute('aria-pressed',String(enabled));
  };
  const toBytes=key=>{
    const base64=key.replace(/-/g,'+').replace(/_/g,'/');
    const binary=atob(base64.padEnd(Math.ceil(base64.length/4)*4,'='));
    return Uint8Array.from(binary,c=>c.charCodeAt(0));
  };
  const post=async(path,payload)=>{
    const response=await fetch(path,{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json','RequestVerificationToken':token||''},
      body:JSON.stringify(payload)
    });
    if(!response.ok)throw new Error('Não foi possível atualizar a assinatura ('+response.status+').');
    return response.json();
  };
  async function getRegistration(){
    const registration=await navigator.serviceWorker.register('/service-worker.js',{scope:'/',updateViaCache:'none'});
    return navigator.serviceWorker.ready;
  }
  async function init(){
    if(!supported){message('Notificações não são suportadas neste navegador.');return;}
    try{
      const configResponse=await fetch('/api/push/config',{credentials:'same-origin',cache:'no-store'});
      if(!configResponse.ok)throw new Error('Serviço indisponível.');
      const config=await configResponse.json();
      if(!config.enabled){message('Envio de notificações aguardando configuração do administrador.');return;}
      const registration=await getRegistration();
      const subscription=await registration.pushManager.getSubscription();
      if(subscription && Notification.permission==='granted'){
        // Restore this device's subscription on login and after reload.
        const json=subscription.toJSON();
        await post('/api/push/subscribe',{
          endpoint:subscription.endpoint,
          p256dh:json.keys?.p256dh||'',
          auth:json.keys?.auth||''
        });
      }
      updateButton(!!subscription);
      message(subscription?'Notificações ativadas neste dispositivo.':'Avisos diários de despesas sem baixa.');
      button.addEventListener('click',async()=>{
        button.disabled=true;
        try{
          const current=await registration.pushManager.getSubscription();
          if(current){
            await post('/api/push/unsubscribe',{endpoint:current.endpoint});
            await current.unsubscribe();
            updateButton(false);
            message('Notificações desativadas neste dispositivo.');
          } else {
            const permission=await Notification.requestPermission();
            if(permission!=='granted')throw new Error('Permissão de notificações não concedida.');
            const fresh=await registration.pushManager.subscribe({
              userVisibleOnly:true,applicationServerKey:toBytes(config.publicKey)
            });
            const json=fresh.toJSON();
            try{
              await post('/api/push/subscribe',{
                endpoint:fresh.endpoint,
                p256dh:json.keys?.p256dh||'',
                auth:json.keys?.auth||''
              });
            } catch(error){
              await fresh.unsubscribe();
              throw error;
            }
            updateButton(true);
            message('Notificações ativadas neste dispositivo.');
          }
        }catch(error){message(error.message||'Não foi possível ativar notificações.');}
        finally{button.disabled=false;}
      });
    }catch(error){message(error.message||'Notificações indisponíveis.');}
  }
  init();
})();
