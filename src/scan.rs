use crate::config::GraphSettings;
use crate::graph::{
    DependencyGraph, EdgeKind, ImportEdge, ImportReference, SourceFile, UnresolvedImport,
};
use crate::parser::{self, ImportSpec, Language, ParsedSource};
use crate::resolve::{Resolver, SourceUnit};
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

pub fn build(settings: GraphSettings) -> Result<DependencyGraph, String> {
    let mut paths = Vec::new();
    let mut warnings = Vec::new();
    if settings.starts.is_empty() {
        walk(
            &settings.root,
            &settings.root,
            &settings.ignored_directories,
            &mut paths,
            &mut warnings,
        )?;
    } else {
        for start in &settings.starts {
            if has_ignored_directory(&settings.root, start, &settings.ignored_directories) {
                continue;
            }
            if start.is_dir() {
                walk(
                    &settings.root,
                    start,
                    &settings.ignored_directories,
                    &mut paths,
                    &mut warnings,
                )?;
            } else {
                paths.push(start.clone());
            }
        }
    }
    paths.sort();
    paths.dedup();

    let mut sources = Vec::new();
    for absolute in paths {
        let id = relative_id(&settings.root, &absolute)?;
        match std::fs::read_to_string(&absolute) {
            Ok(text) => match parser::parse(&absolute, &text) {
                Ok(parsed) => {
                    if parsed.has_parse_errors {
                        warnings.push(format!("{} contains recoverable syntax errors", id));
                    }
                    sources.push(SourceUnit {
                        id,
                        content: text,
                        parsed,
                    });
                }
                Err(error) => {
                    warnings.push(format!("could not parse {id}: {error}"));
                    sources.push(SourceUnit {
                        id,
                        content: text,
                        parsed: ParsedSource {
                            language: Language::from_path_for_scan(&absolute),
                            ..ParsedSource::default()
                        },
                    });
                }
            },
            Err(error) => warnings.push(format!("could not read {}: {error}", absolute.display())),
        }
    }
    let crate_name = rust_crate_name(&settings.root);
    let resolver = Resolver::new(&sources, crate_name, &settings.root);
    warnings.extend(resolver.warnings.iter().cloned());
    let mut edges: BTreeMap<(String, String, EdgeKind), BTreeSet<ImportReference>> =
        BTreeMap::new();
    let mut unresolved = Vec::new();
    for source in &sources {
        for import in &source.parsed.imports {
            let targets = if import.kind == EdgeKind::Module {
                resolver
                    .resolve_rust_module(source, import)
                    .into_iter()
                    .collect()
            } else {
                resolver.resolve_all(source, import)
            };
            for target in &targets {
                if target != &source.id {
                    edges
                        .entry((source.id.clone(), target.clone(), import.kind))
                        .or_default()
                        .insert(ImportReference {
                            line: import.line,
                            path: import.path.clone(),
                        });
                }
            }
            if targets.is_empty()
                && (resolver.is_local_typescript_alias(source, import)
                    || resolver.is_local_go_import(import)
                    || is_local_rust_path(source, import, &settings.root, &resolver))
            {
                unresolved.push(UnresolvedImport {
                    file: source.id.clone(),
                    line: import.line,
                    path: import.path.clone(),
                });
            }
        }
    }

    let nodes = sources
        .iter()
        .map(|source| SourceFile {
            id: source.id.clone(),
            domain: domain_for(&source.id, &settings.domains),
            language: source
                .parsed
                .language
                .map_or("unknown", Language::name)
                .to_owned(),
            content: source.content.clone(),
        })
        .collect();
    let edges = edges
        .into_iter()
        .map(|((source, target, kind), references)| ImportEdge {
            source,
            target,
            kind,
            references: references.into_iter().collect(),
        })
        .collect();
    unresolved.sort_by(|left, right| {
        (&left.file, left.line, &left.path).cmp(&(&right.file, right.line, &right.path))
    });
    warnings.sort();
    Ok(DependencyGraph {
        id: settings.id,
        name: settings.name,
        group: settings.group,
        domains: settings.domains,
        nodes,
        edges,
        unresolved,
        warnings,
        limitations: "Static AST import extraction. Go imports are mapped to scanned packages declared by the nearest go.mod. Local Rust module paths, PHP declared symbols, Python module paths, relative TypeScript paths and TypeScript paths from the nearest tsconfig, and Kotlin package imports are resolved when they map to scanned files. Kotlin imports that cannot be matched to a declared symbol are linked to the nearest scanned package. Compiler name resolution, Go workspace and replace directives, package export conditions, Composer autoload rules, Python runtime import hooks, generated code, and external packages are not resolved.".to_owned(),
    })
}

fn walk(
    root: &Path,
    current: &Path,
    ignored_directories: &[String],
    files: &mut Vec<PathBuf>,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(current)
        .map_err(|error| format!("cannot scan {}: {error}", current.display()))?;
    let mut entries = entries
        .filter_map(|entry| match entry {
            Ok(entry) => Some(entry),
            Err(error) => {
                warnings.push(format!(
                    "cannot read directory entry under {}: {error}",
                    current.display()
                ));
                None
            }
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("cannot inspect {}: {error}", path.display()))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            let name = entry.file_name();
            if ignored_directories
                .iter()
                .any(|ignored| name == OsStr::new(ignored))
            {
                continue;
            }
            walk(root, &path, ignored_directories, files, warnings)?;
        } else if file_type.is_file()
            && Language::from_path_for_scan(&path).is_some()
            && path.starts_with(root)
        {
            files.push(path);
        }
    }
    Ok(())
}

fn has_ignored_directory(root: &Path, path: &Path, ignored_directories: &[String]) -> bool {
    path.strip_prefix(root).is_ok_and(|relative| {
        relative.components().any(|component| {
            ignored_directories
                .iter()
                .any(|ignored| component.as_os_str() == OsStr::new(ignored))
        })
    })
}

fn relative_id(root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .map_err(|_| {
            format!(
                "source file is outside the project root: {}",
                path.display()
            )
        })
}

fn domain_for(id: &str, domains: &[crate::graph::ConfiguredDomain]) -> Option<String> {
    domains
        .iter()
        .filter(|domain| id.starts_with(&format!("{}/", domain.path)))
        .max_by_key(|domain| domain.path.len())
        .map(|domain| domain.name.clone())
}

fn rust_crate_name(root: &Path) -> Option<String> {
    let manifest = std::fs::read_to_string(root.join("Cargo.toml")).ok()?;
    let manifest: toml::Value = toml::from_str(&manifest).ok()?;
    manifest
        .get("lib")
        .and_then(|lib| lib.get("name"))
        .and_then(toml::Value::as_str)
        .or_else(|| {
            manifest
                .get("package")
                .and_then(|pkg| pkg.get("name"))
                .and_then(toml::Value::as_str)
        })
        .map(|name| name.replace('-', "_"))
}

fn is_local_rust_path(
    source: &SourceUnit,
    import: &ImportSpec,
    root: &Path,
    resolver: &Resolver,
) -> bool {
    if source.parsed.language != Some(Language::Rust) || import.kind == EdgeKind::Module {
        return false;
    }
    let path = import.path.trim_start_matches(':');
    path.starts_with("crate::")
        || path.starts_with("self::")
        || path.starts_with("super::")
        || rust_crate_name(root).is_some_and(|name| path.starts_with(&format!("{name}::")))
        || resolver.resolve(source, import).is_some()
}
