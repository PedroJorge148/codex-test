# Estratégia de importação

## Fluxo e limites

Enviar CSV/XLSX → escolher planilha/separador → prévia → mapeamento → solicitar validação → revisar relatório → confirmar linhas prontas → acompanhar resultados.

Limites: 10 MB de arquivo, 10 mil linhas e 100 colunas. CSV exige UTF-8, cabeçalhos únicos e separador explícito. XLSX aceita uma planilha por importação, até 50 MB descompactados, sem macros, vínculos externos ou avaliação de fórmulas. Células com fórmulas/erros são reportadas. Parser em worker thread tem limite de memória e tempo.

O arquivo e os dados preparados são criptografados no banco. A API enfileira a validação; o worker avança em blocos de 25 linhas para permitir retomada e liberar a organização entre blocos. O parser pode reler o arquivo por bloco: uma escolha simples para o limite do MVP, a revisar caso o custo de arquivos grandes seja relevante.

## Mapeamento e validação

Destinos são nome/e-mail/telefone, IDs externos de candidato/candidatura, ID interno da vaga e campos existentes. Uma vaga padrão pode atender o arquivo inteiro. Não criar colunas ou vagas implicitamente. Colunas ignoradas preservam valores; célula vazia mapeada limpa o valor, sujeito à obrigatoriedade. Datas brasileiras e separador decimal são escolhas explícitas; não adivinhar formatos ambíguos.

A validação usa as mesmas operações de domínio em savepoint revertido: verifica referências, regras e versões sem deixar cadastros ou auditoria de escrita fictícios. O resultado preparado guarda a versão observada. Mudança de esquema exige nova validação.

## Identidade e deduplicação

IDs externos são únicos por organização, sistema de origem e entidade. Candidatura conhecida pode ser atualizada; candidato conhecido pode ser reutilizado em outra vaga. Contatos iguais sem identidade confiável são ambíguos, nunca mesclados automaticamente. Divergências nos contatos de um candidato reutilizado exigem revisão explícita. Candidaturas repetidas no arquivo são detectadas inclusive entre blocos.

Registro excluído não é restaurado por importação. Confirmar novamente a mesma operação é idempotente. Cada linha aplica em transação própria; falha não afeta linhas anteriores. Resultados: criada, atualizada, sem alteração, inválida, ambígua ou conflito. Sem alteração não incrementa a versão. Registros alterados após prévia geram conflito, sem sobrescrita.

O contrato `CandidateSource.read(cursor)` entrega registros normalizados e próximo cursor. `SimulatedGupySource` exercita paginação, duplicatas e falhas. Não há acesso real à API da Gupy; credenciais, escopos e semântica de IDs precisam de confirmação antes de outro adaptador.
