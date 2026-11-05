# Leitura de QR Code fiscal nas Despesas

Esta alteração foi desenvolvida a partir do commit de referência do **ATLAS 2.0** `80697dd7561660f4a7096e18ebaf1511e5dc89ca`, preservado na branch `backup/atlas-2.0-2026-11-05`.

## Escopo efetivamente implementado

- Em **Despesas → Ler QR Code** / **Nova despesa**, ler QR Code com câmera em navegadores compatíveis com BarcodeDetector; opcionalmente carregar foto ou colar conteúdo/link.
- Reconhecer NFC-e/NF-e por chave de 44 dígitos com dígito verificador válido, extrair CNPJ do emitente e mês/ano do documento.
- Quando o QR Code de contingência *offline* trouxer o campo de valor total vNF, preencher o valor. Caso contrário, não inventar valor nem nome comercial.
- Expor o endereço do portal fiscal original para conferência. Não contornar CAPTCHA, autenticação ou respostas que exigem JavaScript. Não executar scraping ou downloads externos.
- Sugerir descrição genérica e categoria Compras, deixando tudo editável. A data de competência, status de pagamento e forma de pagamento permanecem sob controle do usuário.
- Manter a chave fiscal nas observações do lançamento e impedir o cadastro repetido da mesma chave pelo mesmo usuário.
- Usar sempre o fluxo de salvamento e validação já existente do ATLAS: somente o usuário confirma o registro.
- Sem IA generativa, novas tabelas, alterações destrutivas de dados ou envio de fotos ao backend.

## Limitações conhecidas

O QR Code, em especial o online, frequentemente contém **a URL e a chave**, não o valor, a data completa, os itens ou o nome comercial. A câmera e a leitura de imagem requerem suporte do navegador à API BarcodeDetector e HTTPS; nos demais casos o usuário pode utilizar um leitor externo do aparelho e colar o link. Algumas consultas da SEFAZ exigem CAPTCHA. A leitura de QR Code não é validação da situação fiscal do documento no portal. Sempre conferir informações antes do registro.

## Reversão

A alteração é isolada em PR próprio e poderá ser revertida pelo commit de integração sem afetar o ATLAS 2.0 ou registros já existentes. Despesas criadas durante o uso continuam sendo registros financeiros legítimos; revertê-lo não apaga nem corrige lançamentos.
