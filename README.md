# ATLAS — Sistema Financeiro

Aplicação Node.js e SQL Server para ambiente MonsterASP.NET.

## Requisitos

- Node.js 20 ou superior
- SQL Server acessível
- Variável de ambiente `ConnectionStrings__DefaultConnection` (ou `DB_CONNECTION_STRING`), configurada **somente no servidor**
- Host MonsterASP configurado para Node.js via `httpPlatformHandler`

## Execução

```
npm install
npm run check
npm start
```

Primeira instalação: abra a URL e crie a conta de administrador. Se o banco já tiver a tabela `dbo.Usuarios` populada, utilize a conta existente; o sistema reconhece o hash anterior baseado em `scrypt`.

## Segurança de dados

As tabelas financeiras novas têm prefixo `AtlasV2`. O código não exclui nem altera as tabelas financeiras antigas. Cada entidade financeira possui `user_id`, e as consultas são limitadas à conta autenticada. Os módulos possuem tabelas separadas. Sessões são armazenadas por hash no SQL Server, e os logs de alterações ficam em `AtlasV2Audit`.

## Estado de implementação

Inclui autenticação, seleção de ambiente, dashboards, lançamentos, contas, cartões, serviços, metas, relatórios anuais, parcelamentos determinados e geração limitada de recorrências. Ainda requer validação contra um SQL Server real/MonsterASP e endurecimento de produção, incluindo transações atômicas para séries, paginação, recuperação segura de conta, controle preciso de faturas e cronograma de recorrências abertas. Recorrências abertas são estendidas ao consultar períodos futuros, mantendo vínculos e histórico. O ambiente de produção ainda precisa de validação direta contra o SQL Server e o MonsterASP.