# Importação de despesas por QR Code fiscal

Referência preservada: ATLAS 2.0 — `backup/atlas-2.0-2026-11-05` (`80697dd7561660f4a7096e18ebaf1511e5dc89ca`).

## Fluxo único solicitado

1. Na tela **Nova despesa**, usar câmera, foto do QR Code ou colar o endereço fiscal.
2. O ATLAS valida a chave de 44 dígitos e, se o QR trouxer URL de consulta, tenta buscar **automaticamente a página pública da SEFAZ** indicada pelo próprio documento.
3. A partir dessa página, quando os campos puderem ser verificados, recupera estabelecimento, valor, data, produtos e pagamento; sugere categoria por regras determinísticas, apenas quando os produtos permitem classificação inequívoca.
4. Apresenta os campos para conferência e exige que o usuário salve a despesa manualmente.

**Não há importação de XML, nenhuma IA e nenhum envio da foto da nota para outro site.**

## Limitações reais

A chave fiscal e a URL sozinhas não contêm todos os dados da nota. O portal público pode apresentar CAPTCHA, redirecionamento, erros ou um leiaute estadual não reconhecido. O ATLAS não contorna CAPTCHA nem inventa informações: informa o motivo e mantém o formulário disponível. O parser da página fiscal depende do leiaute da SEFAZ e deve ser validado com documentos reais de cada UF para garantir cobertura. Uma consulta HTML bem-sucedida não substitui verificação de autenticidade e autorização fiscal.

## Segurança

Sem migração de banco e sem edição ou exclusão de registros existentes; links de consulta só são requisitados no servidor quando HTTPS, host governamental brasileiro e caminho fiscal reconhecido. Sem redirecionamentos automáticos, com limite de 1,5 MB e timeout de nove segundos. O documento é processado em memória; fotos não são enviadas ao backend. O lançamento exige confirmação do usuário.

## Rollback

A feature fica isolada em PR. Para retornar ao ATLAS 2.0, restaurar os arquivos versionados a partir da branch de backup; o SQL Server não está incluído nesse ponto de restauração.
