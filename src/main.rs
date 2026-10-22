mod config;
mod graph;
mod parser;
mod resolve;
mod scan;

use std::path::{Path, PathBuf};

fn main() {
    if let Err(error) = run() {
        eprintln!("Error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut config_path = None;
    let mut root_override = None;
    let mut output_path = None;
    let mut positional_root = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--config" => config_path = Some(PathBuf::from(next_value(&mut args, "--config")?)),
            "--root" => root_override = Some(PathBuf::from(next_value(&mut args, "--root")?)),
            "--output" | "-o" => output_path = Some(PathBuf::from(next_value(&mut args, &arg)?)),
            "--help" | "-h" => {
                print_help();
                return Ok(());
            }
            value if value.starts_with('-') => return Err(format!("unknown option: {value}")),
            value if positional_root.is_none() => positional_root = Some(PathBuf::from(value)),
            value => return Err(format!("unexpected argument: {value}")),
        }
    }
    if root_override.is_some() && positional_root.is_some() {
        return Err(
            "provide the project root either positionally or with --root, not both".to_owned(),
        );
    }
    let root_override = root_override.as_deref().or(positional_root.as_deref());
    let settings = config::load(config_path.as_deref(), root_override)?;
    let output_path = output_path.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("viewer/public/graph.json")
    });
    let mut graphs = Vec::with_capacity(settings.graphs.len());
    for graph_settings in settings.graphs {
        graphs.push(scan::build(graph_settings)?);
    }
    let output = match output_path.extension().and_then(|ext| ext.to_str()) {
        Some("json") => {
            serde_json::to_string_pretty(&graph::DependencyGraphCollection { graphs: &graphs })
                .map(|json| format!("{json}\n"))
                .map_err(|error| error.to_string())?
        }
        Some("dot") => graph::render_dot(&graphs),
        _ => return Err("--output must end in .json or .dot".to_owned()),
    };
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    std::fs::write(&output_path, output)
        .map_err(|error| format!("cannot write {}: {error}", output_path.display()))?;
    let files = graphs.iter().map(|graph| graph.nodes.len()).sum::<usize>();
    let relationships = graphs.iter().map(|graph| graph.edges.len()).sum::<usize>();
    let domains = graphs
        .iter()
        .map(|graph| graph.domains.len())
        .sum::<usize>();
    println!(
        "{} graph(s), {} files, {} relationships, {} domains",
        graphs.len(),
        files,
        relationships,
        domains
    );
    println!("Created {}", absolute_for_display(&output_path).display());
    let unresolved = graphs
        .iter()
        .map(|graph| graph.unresolved.len())
        .sum::<usize>();
    let warnings = graphs
        .iter()
        .map(|graph| graph.warnings.len())
        .sum::<usize>();
    if unresolved > 0 || warnings > 0 {
        println!(
            "{} unresolved local imports; {} warnings (see report diagnostics)",
            unresolved, warnings
        );
    }
    Ok(())
}

fn next_value(args: &mut impl Iterator<Item = String>, option: &str) -> Result<String, String> {
    args.next()
        .ok_or_else(|| format!("{option} requires a value"))
}

fn absolute_for_display(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    }
}

fn print_help() {
    println!(
        "dependency-graph [PROJECT_ROOT] [--config PATH] [--root PATH] [--output PATH]\n\
         Scan Rust, Go, PHP, Python, TypeScript, and Kotlin imports and write graph JSON or DOT.\n\
         Configure independent graphs with [[graphs]] entries in config.toml.\n\
         PROJECT_ROOT overrides crate_root when the config defines one graph."
    );
}
