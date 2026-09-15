# Requisitos

## Funcionais

| ID | Requisito |
| --- | --- |
| RF-01 | Login, logout, convite, verificação de e-mail e recuperação de senha via Keycloak |
| RF-02 | Isolamento por organização e vínculos com papel administrador/usuário |
| RF-03 | Criar, consultar e editar candidatos/candidaturas; excluir logicamente e restaurar candidaturas como administrador |
| RF-04 | Configurar campos, padrões, obrigatoriedade, limites e opções |
| RF-05 | Grade com teclado, edição, colagem até 200 linhas/2 mil células na página e desfazer da última edição/lote |
| RF-06 | Consulta no servidor: busca, filtros AND, até três ordenações, paginação com desempate por ID |
| RF-07 | SSE, reconciliação após desconexão e controle otimista de versões |
| RF-08 | Importação CSV/XLSX com confirmação explícita e relatório por linha |
| RF-09 | Auditoria com ator, horário, ação, entidade, campo, valores anterior/novo, origem e correlação |
| RF-10 | Dashboard fixo derivado das operações auditadas |
| RF-11 | Exportação do titular, eliminação controlada e retenção configurável |
| RF-12 | Adaptador Gupy simulado e contrato desacoplado de integração |

## Regras de campos

Tipos: texto, texto longo, número, data, data/hora, e-mail, telefone, booleano, seleção única, múltipla, URL e responsável. O backend aplica as mesmas regras a edição, colagem, desfazer e importação. Responsáveis novos precisam estar ativos na organização. Opções arquivadas preservam valores anteriores, mas não aceitam novas atribuições.

Padrões valem apenas para novos registros. `0` e `false` não são vazios. Datas usam calendário ISO; horários exigem fuso explícito e são normalizados. Número usa precisão segura de JavaScript, não aritmética financeira. Não há validação por código/regex arbitrária. Mudança de tipo exige outra coluna. Regras incompatíveis com valores existentes são recusadas.

## Não funcionais

- RNF-01: TypeScript estrito; pnpm; licenças e lockfile revisáveis.
- RNF-02: escrita, auditoria e outbox atômicas; idempotência por operação.
- RNF-03: RLS, referências compostas, autorização no backend e CSRF.
- RNF-04: logs técnicos sem dados pessoais completos ou segredos; payloads auditados criptografados.
- RNF-05: processos API/worker reiniciáveis; backups criptografados e ensaio de recuperação.
- RNF-06: metas iniciais p95 de leitura até 1 s, escrita até 500 ms e propagação até 2 s, sujeitas à medição e ao dimensionamento real.
