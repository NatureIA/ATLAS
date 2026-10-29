# ATLAS — Gestão Financeira

Aplicação financeira implementada em **ASP.NET Core MVC (.NET 8)**, **C#**, **Entity Framework Core**, **SQL Server**, **Razor Views**, HTML, CSS e JavaScript, seguindo exclusivamente o documento funcional fornecido em 29/10/2026.

## Áreas da aplicação

Visão geral; Faturamento; Despesas; Itens de receita; Metas; Relatórios.

A data do lançamento é a competência financeira. O sistema oferece receitas mensais recorrentes, despesas mensais recorrentes, parcelamentos por cartão/boleto com valor **unitário por parcela**, controle booleano Pago/Pendente, regras de histórico, projeção mensal, metas, agrupamentos e relatórios anuais.

## Implantação MonsterASP.NET

1. O projeto usa ASP.NET Core MVC e deve ser configurado como aplicação **.NET 8** no MonsterASP, não como aplicativo Node.js.
2. Mantenha a variável de ambiente privada `ConnectionStrings__DefaultConnection` apontando para a sua base SQL Server. Não coloque credenciais no GitHub.
3. O workflow `.github/workflows/deploy.yml` compila em Windows e executa Web Deploy apenas em `main`. Os secrets necessários são `WEBSITE_NAME`, `SERVER_COMPUTER_NAME`, `SERVER_USERNAME` e `SERVER_PASSWORD`.
4. Se estiver utilizando **Git deploy** no painel (em vez de Actions/WebDeploy), selecione o tipo **Build .NET app**, projeto `Atlas.csproj` e branch `main`; a publicação automática depende do plano e das configurações desse recurso.
5. Após a publicação, confira `/health` (processo HTTP) e, autenticado, `/health/db` (conectividade SQL). Certifique-se de que o site esteja acessível por HTTPS antes do login: cookies são `HttpOnly`, `SameSite=Lax` e `Secure`.

## Banco de dados e preservação

- Todos os dados financeiros novos ficam nas tabelas `dbo.AtlasFin*`.
- O aplicativo reutiliza exclusivamente a tabela antiga `dbo.Usuarios` para preservar as contas de autenticação já existentes, **sem apagar registros**.
- Senhas antigas em formato `salt:hex` do Node.js são verificadas com `scrypt` e convertidas ao formato seguro do ASP.NET Identity após um login bem-sucedido.
- A criação de tabelas é aditiva e idempotente. Nenhuma tabela financeira legada é excluída ou migrada automaticamente.
- Caso o banco não tenha usuários, a instalação inicial requer a variável `ATLAS_SETUP_KEY` e o formulário `/Auth/Setup` para impedir a criação indevida de um administrador.

## Segurança e integridade

- As consultas utilizam `UserId` obtido das Claims, nunca de formulário.
- Operações mutáveis estão protegidas por antifalsificação.
- Recorrências têm índice único `(RecurringSeriesId, RecurringOccurrenceKey)` e revisões históricas de valores para que alterações futuras não modifiquem meses passados.
- Os cálculos financeiros utilizam `decimal(18,2)` e nunca `float`.
- Auditoria das operações relevantes é persistida em SQL Server.

## Desenvolvimento

```bash
dotnet restore Atlas.csproj
dotnet build Atlas.csproj -c Release
dotnet run --project Atlas.csproj
```

É obrigatório validar o build e o deploy, autenticação em HTTPS, conexão SQL Server e os principais fluxos financeiros antes de declarar a aplicação pronta para produção.