# ATLAS — Notificações Web Push

O ATLAS apresenta um convite automático após o login, por dispositivo, sem exigir procura por um botão na barra lateral. O usuário toca em **Ativar notificações** para solicitar a permissão nativa ao navegador. Não é possível abrir a permissão nativa de forma confiável sem um gesto do usuário. O ATLAS envia um lembrete consolidado por dispositivo e
por dia quando existe pelo menos uma despesa com **Paid = false** e
**Date <= data atual**. O campo Date é a competência, não o vencimento:
não informar no texto que uma conta "vence hoje" ou "está atrasada".

## Configuração privada obrigatória

No painel da MonsterASP, configure como variáveis de ambiente do site:

- `ATLAS_VAPID_PUBLIC_KEY` — chave pública Web Push (base64url)
- `ATLAS_VAPID_PRIVATE_KEY` — chave privada Web Push (base64url)
- `ATLAS_VAPID_SUBJECT` — `https://salta-atlas.runasp.net`
- `ATLAS_PUSH_JOB_KEY` — segredo aleatório do endpoint de envio diário

As chaves VAPID devem ser geradas uma única vez e permanecer estáveis.
**Nunca incluir a chave privada ou o segredo da tarefa no GitHub.**

No GitHub, em **Settings → Secrets and variables → Actions → New repository secret**,
crie somente o secret `ATLAS_PUSH_JOB_KEY` com o mesmo valor do MonsterASP.

O arquivo `.github/workflows/push-reminders.yml` aciona
`POST /api/push/dispatch` a cada **10 minutos** (minutos 03, 13, 23, 33, 43 e 53 UTC). Isso gera tráfego regular que reduz a chance de hibernação no MonsterASP Free. Os lembretes seguem limitados a um envio por dia/dispositivo. O GitHub Actions pode atrasar ou até cancelar execuções agendadas; não equivale a monitoramento garantido 24×7.
Também permite execução manual em **Actions**.

## Funcionamento

1. Após entrar no ATLAS, o convite aparece automaticamente; clicar **Ativar notificações** no convite.
2. Autorizar a notificação no dispositivo.
3. O navegador envia a assinatura ao backend e ela fica vinculada ao usuário.
4. O job diário lê somente despesas sem baixa do próprio usuário e envia um
   aviso genérico com a quantidade. Ele não expõe valores na tela bloqueada.
5. Ao clicar na notificação, o usuário vai à página de despesas pendentes.
6. Para desativar notificações, revogar a permissão nas configurações do navegador/dispositivo. O cadastro poderá ser reativado quando o navegador permitir.

### Limitações operacionais

- O navegador e o sistema operacional controlam a entrega efetiva. Não há
  garantia de chegada instantânea, mesmo com o PWA fechado.
- Em iOS, instale o PWA na Tela de Início e permita notificações.
- A conta Free do MonsterASP pode adormecer; por isso o agendamento é externo
  (GitHub Actions) e não depende de serviço residente.
- A primeira publicação precisa de autorização para criar a tabela aditiva
  `dbo.AtlasPushSubscriptions`. Falhas de DDL precisam ser corrigidas antes
  de habilitar notificações.
- Nenhuma operação marca despesas como pagas automaticamente.
- Para alertas de vencimento com dia preciso, o sistema precisará de
  uma data de vencimento independente da competência em todos os lançamentos.
