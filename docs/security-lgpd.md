# Segurança, privacidade e recuperação

## Controle de acesso

Keycloak gerencia senhas, verificação de e-mail, recuperação e proteção contra tentativas repetidas. A aplicação usa OIDC/PKCE, estado, nonce, sessão opaca HttpOnly e validação CSRF/origem. Cadastro público é desativado. O provisionamento inicial associa um endereço previamente configurado a uma identidade OIDC com e-mail verificado.

Vínculos e papéis são validados no servidor; não confiar em organização/role enviados pelo cliente. Jobs e SSE também verificam autorização. O último administrador não pode ser removido. O papel do banco não é proprietário, superusuário ou BYPASSRLS. Políticas RLS e FKs compostas complementam a camada HTTP. [Comportamento de RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

## Dados e auditoria

Logs técnicos não incluem corpos, SQL com parâmetros, arquivos, e-mails ou tokens. Auditoria de negócio guarda metadados da operação e valores anterior/novo criptografados; somente administradores podem consultá-los, e a consulta também é registrada. O dashboard usa metadados, sem descriptografar contatos.

Segredos ficam fora do Git. `AUDIT_KEY` deve ser guardada separadamente dos backups; perder essa chave impede recuperar payloads históricos e backups. A versão local usa uma chave; rotação em produção requer plano de recriptografia e retenção da chave anterior até a conclusão.

## Retenção e atendimento ao titular

A LGPD diferencia término do tratamento, hipóteses de conservação e direitos do titular. Exclusão lógica não equivale a eliminação. [Lei 13.709, artigos 15, 16 e 18](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm).

O controlador deve aprovar finalidade, base legal, prazos e responsáveis antes de produção. Não presumir consentimento universal. `RETENTION_APPROVED`, `RETENTION_DAYS` e `AUDIT_RETENTION_DAYS` tornam essa decisão explícita. O prazo automático de candidatos começa após a última candidatura excluída; candidatos com candidaturas ativas são preservados. O encerramento de processos e eventuais obrigações de conservação precisam ser tratados pela organização.

Arquivos/preparação expiram em 24 horas; payloads de auditoria expiram segundo a configuração. Eliminação administrativa limpa contatos, campos, IDs externos e valores auditados, mantendo metadados mínimos e registro de eliminação. Arquivos temporários da organização são descartados porque podem conter o titular em colunas arbitrárias. Exportação do titular é autenticada e auditada.

## Backup e restauração

`pnpm backup` produz dumps criptografados de aplicação e Keycloak. Agendar cópia externa, testar acesso às chaves e definir RPO/RTO com a organização. Arquivos locais não protegem contra perda do host.

`pnpm recovery:rehearse <diretório>` restaura a aplicação em banco novo, reaplica o registro mais recente de eliminações e invalida sessões restauradas. O banco original não é substituído. Em desastre real, a fonte do registro de eliminações deve ser uma cópia externa atualizada; não confiar somente no registro contido num dump antigo. Só liberar tráfego após restaurar identidade, permissões, eliminações e verificar as contas de acesso. O Compose local não deve ser exposto diretamente à internet; utilizar TLS, proxy e Keycloak em modo de produção.
