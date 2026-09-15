# Entre — gestão colaborativa de candidaturas

MVP para equipes de RH: grade editável, campos tipados, importação CSV/XLSX, colaboração em tempo real, concorrência otimista e auditoria. Uma pessoa pode ter candidaturas em várias vagas sem duplicar seus contatos.

## Executar localmente

Requisitos: **Docker Engine/Compose**, **Node.js 24+** e **pnpm 11.11.0**. Não é necessário instalar PostgreSQL no host.

```sh
pnpm install --frozen-lockfile
pnpm mvp:up
pnpm mvp:status
```

Na primeira execução, aguarde a inicialização do Keycloak. O comando cria credenciais aleatórias em `.local/dev.env`, preserva configurações existentes, constrói a aplicação, aplica migrações e provisiona o primeiro administrador.

| Serviço | Endereço |
| --- | --- |
| Aplicação | http://localhost:3000 |
| E-mails de teste (Mailpit) | http://localhost:8025 |
| Keycloak | http://localhost:8080 |
| PostgreSQL de desenvolvimento | `127.0.0.1:55433` |

Entre com **`admin@example.test`** e a senha da variável **`INITIAL_ADMIN_PASSWORD`** em `.local/dev.env`. Abra esse arquivo localmente; não cole suas credenciais em chamados ou commits. A senha do console Keycloak é outra variável: `KEYCLOAK_BOOTSTRAP_PASSWORD`, usuário `admin`.

`pnpm mvp:up` lê **`.local/dev.env`**, não `.env` (este serve para executar os processos no host). A aplicação aguarda a descoberta OIDC do Keycloak antes de iniciar. `INITIAL_ADMIN_PASSWORD` só define a senha na primeira importação do realm: alterar o arquivo depois não altera a senha já persistida. Para trocar uma senha existente, use a recuperação de senha na tela de login e abra a mensagem no Mailpit; não exclua o volume do banco.

1. Em **Configurações**, crie uma vaga e os campos desejados.
2. Em **Candidaturas**, cadastre uma pessoa ou reutilize um candidato existente.
3. Dê duplo clique numa célula para editar; salve explicitamente. Alterações nos contatos afetam todas as candidaturas da pessoa.
4. Convide um usuário por **Configurações** e abra o e-mail no Mailpit. Nenhuma mensagem é enviada à internet pelo SMTP local.
5. Em **Importações**, selecione um arquivo, mapeie colunas, solicite validação, confira o relatório e confirme as linhas prontas.

`pnpm mvp:down` para os serviços e preserva o volume do banco. `pnpm mvp:up` reinicia e aplica novas migrações. Não use `down -v` se quiser preservar os dados. Não gere novas senhas enquanto estiver reutilizando um volume já inicializado.

## Desenvolvimento e verificações

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e:docker
```

O E2E usa a stack local ativa e dados sintéticos; cria registros identificados por sufixos aleatórios. A imagem Playwright fornece o navegador e suas bibliotecas. Em sistemas cujo usuário não é UID/GID 1002, defina `LOCAL_UID` e `LOCAL_GID` em `.local/dev.env`. O container E2E usa rede do host; no Docker Desktop, habilite esse recurso ou execute o Playwright no host.

`pnpm test` executa testes unitários e pula a integração quando não existem URLs de teste. Para a suíte PostgreSQL, use um banco **exclusivamente de testes**, terminado em `_test`; o banco do MVP não deve ser utilizado. Defina `TEST_ADMIN_URL` e `TEST_DATABASE_URL` em `.local/test.env`, execute `node --env-file=.local/test.env --import tsx scripts/setup-test-db.ts` e depois `pnpm test:integration`. O container temporário usado no desenvolvimento chama-se `codex-rh-postgres-test`, porta `55432`.

Para executar processos no host, copie `.env.example` para `.env`, preencha valores correspondentes à stack e use `pnpm dev`, `pnpm worker` e, em outro terminal, `pnpm dev:web`. Se utilizar a porta Vite 5173, ajuste `APP_URL`, os redirects/web origins do cliente Keycloak e a configuração de e-mails para essa origem. O caminho mais simples é usar a aplicação compilada na porta 3000.

## Recuperação e operação

```sh
pnpm backup
pnpm recovery:rehearse .local/backups/DIRETORIO_GERADO
```

Os backups de aplicação e identidade são criptografados. O ensaio restaura em banco isolado e reaplica as eliminações posteriores; não substitui o banco em uso. Consulte [segurança e recuperação](docs/security-lgpd.md) antes de definir a operação de produção.

O Compose entregue é **local**, com portas restritas a localhost, Keycloak em modo de desenvolvimento e SMTP capturado. Produção exige HTTPS, Keycloak endurecido, SMTP real, política LGPD aprovada, responsáveis operacionais e backups externos. O código impede `NODE_ENV=production` sem HTTPS e os parâmetros de retenção obrigatórios.

## Estrutura e documentação

- `src/shared`: contratos e validação.
- `src/server`: API, identidade, domínio, importação, outbox e worker.
- `src/web`: interface React.
- `migrations`: SQL versionado, aplicado transacionalmente.
- `tests`: regras, integração PostgreSQL e E2E.
- `scripts` e `infra`: configuração, preparo e recuperação.
- [Arquitetura](docs/architecture-options.md), [modelo](docs/data-model.md), [roadmap](docs/implementation-roadmap.md), [aceite](docs/acceptance-criteria.md) e [estado da implementação](IMPLEMENTATION_STATUS.md).

Não há integração real com a Gupy sem credenciais e contrato confirmados. O adaptador simulado utiliza a mesma entrada de importação. Fórmulas, Kanban, IA, automações, aplicativos móveis e reprodução completa do Excel estão fora deste MVP.
