# Dependarama

A local dependency graph scanner and viewer for Rust, Go, PHP, Python, TypeScript, and Kotlin projects. The Rust CLI writes graph JSON for the TypeScript/Vite viewer. Configure one or more projects and optional domain groups in TOML.

## Run locally

Requires Rust/Cargo, Bun, and [Just](https://just.systems/). From the repository root:

```bash
just install
just dev
```

Open **http://localhost:5178**. The dev command generates graph data before starting the viewer. If `config.toml` is absent, the CLI uses [`config.example.toml`](config.example.toml), which scans this repository. Copy the example to `config.toml` to customize your local setup; `config.toml` is ignored by Git. Run `just` to list the available commands.

## Configure graphs

Each `[[graphs]]` entry defines a project. A graph can set an `id`, display `name`, project root, optional scan starts, and domain color groups:

```toml
[[graphs]]
id = "example-project"
name = "Example project"
crate_root = "../path/to/project"
starts = ["src/domain/orders", "src/domain/users"]

[[graphs.domains]]
name = "orders"
path = "src/domain/orders"

[[graphs.domains]]
name = "users"
path = "src/domain/users"
```

`crate_root` is relative to the TOML file. `starts` and domain `path` values are relative to that graph's root. A start can be a source file or directory; directories are scanned recursively. Leave `starts` empty to scan the full root. Domain paths assign colors to files beneath those directories. A graph without an explicit `id` receives a slug from its name. The viewer hides graph tabs when only one graph is configured. `--root` and the positional project-root override work when the config contains exactly one graph.

## Viewer

The viewer provides a domain overview with cross-domain connections, a package-style file dependency graph, collapsible sidebars, file search, source windows, import references, pan and zoom, and scan diagnostics. Files can be selected to trace their incoming and outgoing imports; clicking the selected file again opens its source. Import, re-export, and module-declaration arrows use distinct line styles. Graph, domain, selected file, source window, and filters are encoded in the URL.

The scanner resolves Go imports to scanned package files using the nearest `go.mod`, local Rust module paths, PHP declared symbols, Python module paths, relative TypeScript module paths and `paths` aliases from the nearest `tsconfig`, and Kotlin package imports when they map to scanned files. Kotlin wildcard imports link to scanned files in the imported package. Go workspace and `replace` directives, compiler name resolution, package export conditions, Composer autoload rules, Python runtime import hooks, generated code, external packages, and macro expansion are not resolved.

## Generate data independently

From the repository root:

Use `just generate` to write the configured graph JSON. Use `just scan /path/to/project` to override the root for a single configured graph, or `just generate-to /tmp/imports.dot` to choose an output path. For other scanner options, run `just scanner-help`.

JSON output contains a `graphs` array. DOT output includes all configured graphs, with separate clusters per graph and domain.

## Build the viewer

Use `just check` to run formatting and type checks, and `just build` to generate graph data and build the viewer.
