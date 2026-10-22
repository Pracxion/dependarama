install:
    bun install

generate:
    cargo run --quiet --

generate-to output:
    cargo run -- --output {{output}}

scan root:
    cargo run -- {{root}}

scanner-help:
    cargo run -- --help

dev: generate
    bun --bun run vite viewer --host 127.0.0.1 --port 5178 --strictPort

check:
    cargo fmt -- --check
    cargo check
    bun --bun run tsc --noEmit

build: generate check
    bun --bun run vite build viewer

preview:
    bun --bun run vite preview viewer --host 127.0.0.1 --port 5178 --strictPort
