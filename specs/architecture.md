# Architecture & Code Structure

Generic engineering principles. No codebase-specific references — see `CLAUDE.md` for stack details.

## Code organization

- **Top-down**: main functions first, then their dependencies (helpers, utilities). Types at the top of the file.
- **Fat modules**: inline the small models/helpers a module needs rather than scattering them.
- **Factory pattern**: use factories for families of similar, colocated classes.
- **Design patterns**: apply creational / structural / behavioral patterns where they fit — don't force them.

## Coding guidelines

- Write like a senior developer: simple, modular, sound.
- **Reuse first**: prefer existing patterns and functions over new ones.
- When you change a file, update its associated files in the same pass (callers, types, tests, docs).
