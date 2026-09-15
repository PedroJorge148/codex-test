# Critérios de aceite

## Núcleo e autorização

- Usuário autenticado vê apenas organizações às quais tem vínculo ativo.
- IDs de outra organização não dão acesso a registros, campos, importações, auditoria ou eventos.
- Papel comum não gerencia campos, vagas, acessos, importações ou exclusões por chamadas diretas.
- Último administrador permanece ativo; requisições mutantes exigem proteção CSRF.
- Registro válido permanece após recarga; campo inválido não deixa dados ou auditoria parciais.

## Campos, consultas e concorrência

- Os 12 tipos têm casos válidos, inválidos, ausentes, obrigatórios e padrões testados.
- Filtros e ordenação ocorrem no servidor, com paginação determinística e valores tipados.
- Duas gravações com a mesma versão resultam em um sucesso e um conflito.
- Lote com erro reverte todas as células. Alteração posterior impede desfazer.
- Idempotência não incrementa versões nem duplica operações confirmadas.
- Exclusão lógica preserva candidato compartilhado; restauração verifica referências/regras atuais.

## Colaboração e importação

- SSE anuncia somente após commit; cliente reconcilia em reconnect e preserva rascunhos.
- CSV/XLSX oferecem prévia, escolha explícita de formato, mapeamento e relatório completo.
- Fórmulas/macros não são executadas; arquivos excessivos são recusados.
- Validação/aplicação retomam no worker sem repetir linhas confirmadas.
- Identidades ambíguas não são mescladas por e-mail; excluídos não ressurgem pela importação.
- Reimportação sem mudança não aumenta a versão. Alteração após prévia gera conflito.

## Auditoria, privacidade e operação

- Escrita, auditoria e outbox são atômicas; falha da auditoria reverte a escrita.
- Valores de auditoria são criptografados; consulta completa é administrativa e auditada.
- Dashboard conta operações distintas e apresenta ação/origem, pessoa e dia.
- Eliminação remove contatos, valores e payloads históricos pertinentes; novas consultas não os recuperam.
- Retenção automática preserva candidaturas ativas e trata somente encerramentos elegíveis.
- Backup criptografado pode ser restaurado em ambiente isolado com reaplicação de eliminações.
- `pnpm typecheck`, `pnpm lint`, testes unitários, integração, build e E2E devem passar.

## Desempenho

Referência de carga: 50 mil candidaturas e 20 editores por organização, até 10 organizações. Alvos p95 de leitura 1 s, escrita 500 ms e propagação 2 s exigem relatório com ambiente e cenário. Medidas locais são evidência de desenvolvimento, não SLA nem certificação de capacidade. Consulte o status e eventuais relatórios de execução para resultados reais.
