# ATLAS — Notificações Web Push

O ATLAS apresenta um convite automático após o login, por dispositivo, sem exigir procura por um botão na barra lateral. O usuário toca em **Ativar notificações** para solicitar a permissão nativa ao navegador. Não é possível abrir a permissão nativa de forma confiável sem um gesto do usuário. O ATLAS avalia a urgência por vencimento às **08h, 12h, 15h e 18h (Brasília)** e envia até quatro lembretes por dispositivo ao dia, somente quando há pendências relevantes. Despesas sem vencimento continuam sendo consideradas pela competência, sem presunção de atraso. O campo Date é a competência, não o vencimento:
não informar no texto que uma conta "vence hoje" ou "está atrasada".


## Alertas inteligentes por vencimento

A **competência financeira** (campo `Date`) e a **data de vencimento** (`DueDate`, opcional) são independentes. A data de vencimento é editável no formulário de despesas; parcelas podem receber o vencimento da primeira parcela e datas mensais subsequentes, e recorrências têm dia do mês e deslocamento mensal próprios.

Cada despesa não paga é reclassificada antes de cada janela, sem cache de status financeiro. O envio é uma notificação consolidada **por dispositivo e por janela**, nunca uma mensagem por despesa.

- **08h:** vencidas, vencendo hoje, amanhã, dentro dos próximos 2–3 ou 4–7 dias; também pendências sem data de vencimento de competências até o mês atual.
- **12h e 15h:** apenas vencidas ou vencendo hoje.
- **18h:** vencidas, vencendo hoje ou amanhã.
- Sem pendências relevantes para a janela: não envia notificação.
- Marcada como paga: sai imediatamente da próxima avaliação.
- Vencimento não informado: não classificar como atrasado; lembrete de competência apenas às 08h.
- Vencimentos em anos anteriores e próximos dias são avaliados pela data completa, não pelo mês da competência.
- O horário é Brasília e o agendamento do GitHub Actions e despertar do MonsterASP não possuem SLA de pontualidade.

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

O arquivo `.github/workflows/push-reminders.yml` tenta acionar `POST /api/push/dispatch`
somente nos horários **08h, 12h, 15h e 18h de Brasília**, com tentativas limitadas aos
minutos **03, 13 e 23** de cada horário. Não há verificações agendadas nas demais horas.
O SQL impede notificações duplicadas ao mesmo dispositivo dentro de cada horário.
Se o GitHub atrasar, o backend aceita o disparo durante a hora correspondente;
fora dela, não reenvia alertas antigos. O MonsterASP Free poderá hibernar entre as verificações; a requisição agendada tenta despertá-lo. O GitHub Actions e a inicialização da hospedagem podem causar atrasos, e atrasos para fora da hora programada podem resultar em uma notificação não enviada. O GitHub Actions pode atrasar ou até cancelar execuções agendadas; não equivale a monitoramento garantido 24×7.
Também permite execução manual em **Actions**.

## Funcionamento

O ATLAS não usa a data registrada como vencimento: uma despesa com competência em qualquer dia do mês entra nos alertas desde o dia 1º daquele mês. Despesas pendentes de meses anteriores também entram, enquanto despesas de meses futuros ficam de fora. O envio é por janela de Brasília e pode ocorrer após o horário nominal devido ao agendador e ao despertar da hospedagem. O GitHub Actions não fornece garantia de execução pontual.

1. Após entrar no ATLAS, o convite aparece automaticamente; clicar **Ativar notificações** no convite.
2. Autorizar a notificação no dispositivo.
3. O navegador envia a assinatura ao backend e ela fica vinculada ao usuário.
4. O agendamento, somente nos quatro horários, lê as despesas sem baixa do próprio usuário e envia um
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


## Recebimentos pessoais (sem fluxo comercial)

As receitas preservam a competência no campo `Date`. A previsão de recebimento fica em `ExpectedReceiptDate`, a confirmação em `Received`, e a data efetiva em `ReceivedDate`. São conceitos independentes. Receitas antigas migram como recebidas para preservar a interpretação financeira anterior; a data efetiva histórica não é inventada. Novas receitas pendentes exigem previsão. Não existem recebimentos parciais ou o estado "sem previsão".

A central de recebimentos usa a competência selecionada para os quatro cards clicáveis: **Recebido**, **A receber**, **Em atraso** e **Próximos 7 dias**. As receitas recorrentes novas geram novas competências pendentes, com previsão mensal; séries legadas preservam sua configuração histórica. A confirmação por botão registra a data do dia em Brasília e é auditada.

Os quatro disparos de Web Push permanecem compartilhados entre receitas e despesas, em uma única notificação consolidada por dispositivo e horário:
- **08h:** receitas em atraso, previstas hoje, amanhã e nos próximos sete dias;
- **12h:** previstas hoje;
- **15h:** em atraso;
- **18h:** previstas hoje ou amanhã.

Os avisos não contêm nomes de pessoas ou valores financeiros na tela bloqueada. O faturamento por competência continua sendo a soma das receitas registradas, independentemente da confirmação. Os resumos de recebimentos são exibidos separadamente e não devem ser interpretados como extrato bancário por data de liquidação.
