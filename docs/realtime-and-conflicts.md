# Colaboração e conflitos

## Escrita e distribuição

Cada mutação autoriza o vínculo, verifica esquema e versões, valida os valores e grava dados, operação auditada e outbox na mesma transação. Nenhum evento de sucesso precede o commit. Falha da auditoria reverte a escrita.

O worker publica notificações PostgreSQL e marca os itens da outbox. A API encaminha eventos SSE apenas a sessões e vínculos ainda válidos. Eventos contêm identificadores de organização/operação, não valores pessoais. O frontend consulta novamente os dados autorizados.

Notificações não são um histórico durável para o navegador: reconexão provoca reconciliação e a grade consulta novamente a cada 30 segundos. Duplicatas são inofensivas porque o evento invalida a consulta. A outbox dura até publicação e retentativas, evitando depender de memória do processo. A perda de um evento após publicação é coberta pela reconciliação.

## Concorrência otimista

Candidato e candidatura têm versões independentes. Alterações enviam a versão observada; divergência resulta em `409 VERSION_CONFLICT` com dados atuais autorizados. Alteração do esquema resulta em `SCHEMA_CONFLICT`. A interface preserva o rascunho e exige revisão antes de reaplicar.

O MVP bloqueia a organização durante escritas para serializar alterações de esquema, permissões e lotes. Isso simplifica invariantes, mas é um limite de throughput a medir. A versão por entidade pode recusar alterações em campos diferentes do mesmo registro; esse conservadorismo evita mesclas implícitas.

## Colagem e desfazer

Colagem aceita TSV com aspas e quebras de linha, até 200 linhas/2 mil células, dentro da página. Não cria linhas implicitamente. Lote com erro/conflito é revertido por inteiro. Valores divergentes para o mesmo candidato no lote são recusados.

Desfazer usa os valores anteriores criptografados da última edição/colagem da sessão. Exige autoria, sessão e versões posteriores compatíveis, além das regras atuais. Gera uma nova operação auditada. Não apaga histórico nem cobre importações, criação, exclusão ou configuração. Não há CRDT, edição offline, cursores ou bloqueios visuais de células.
