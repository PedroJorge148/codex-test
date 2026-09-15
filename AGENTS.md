# Repository Guidelines

## Project Structure & Module Organization

This repository is an initial scaffold with no application code, tests, assets, or package manifest. When introducing the first implementation, organize source code under `src/`, tests under `tests/` or beside their modules, and static assets under `public/` where supported by the chosen framework. Group related modules by feature and update this guide when the structure is established.

## Build, Test, and Development Commands

Prefer `pnpm` for package management. No development, build, test, or lint scripts exist yet. When tooling is introduced, define these scripts in `package.json`:

- `pnpm dev`: start the local development environment.
- `pnpm build`: produce the application build.
- `pnpm test`: run automated tests.
- `pnpm lint`: check code style and static rules.

Always run lint before concluding a task. If tooling is missing or a command fails, report the limitation explicitly. Commit the pnpm lockfile when dependencies are introduced.

## Coding Style & Naming Conventions

Use TypeScript with `strict: true` in `tsconfig.json`. Until a formatter is configured, use two-space indentation, `camelCase` for variables and functions, and `PascalCase` for types and classes. Choose descriptive filenames and follow nearby conventions. No formatter or lint configuration is currently installed.

## Testing Guidelines

No testing framework or coverage threshold has been established. When adding tests, use descriptive names such as `feature.test.ts` and cover observable behavior, including relevant failure cases. Document the selected framework and execution commands here.

## Commit & Pull Request Guidelines

There is no commit history yet. Write Conventional Commit messages in Portuguese, for example `feat: adiciona configuração inicial`, `fix: corrige validação`, or `chore: configura lint`.

Pull requests should describe the change, its purpose, and validation results. Link relevant issues and include screenshots for visible interface changes.

## Dependency & Configuration Rules

Obtain user confirmation before adding any production dependency. Never commit secrets or local credentials; document required configuration with placeholder values.
