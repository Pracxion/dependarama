use crate::parser::{ImportSpec, Language, ParsedSource};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub struct SourceUnit {
    pub id: String,
    pub content: String,
    pub parsed: ParsedSource,
}

pub struct Resolver {
    rust_modules: BTreeMap<String, String>,
    python_modules: BTreeMap<String, String>,
    php_symbols: BTreeMap<String, String>,
    go_packages: BTreeMap<String, BTreeSet<String>>,
    go_module_paths: BTreeSet<String>,
    typescript_files: BTreeSet<String>,
    kotlin_packages: BTreeMap<String, BTreeSet<String>>,
    kotlin_symbols: BTreeMap<String, String>,
    rust_module_by_file: BTreeMap<String, Vec<String>>,
    typescript_paths: BTreeMap<String, Vec<TypeScriptPathMapping>>,
    root: PathBuf,
    pub warnings: Vec<String>,
    crate_name: Option<String>,
}

#[derive(Clone, Debug)]
struct TypeScriptPathMapping {
    pattern: String,
    targets: Vec<String>,
    base_directory: PathBuf,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TypeScriptConfig {
    extends: Option<String>,
    compiler_options: Option<TypeScriptCompilerOptions>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TypeScriptCompilerOptions {
    base_url: Option<String>,
    paths: Option<BTreeMap<String, Vec<String>>>,
}

impl Resolver {
    pub fn new(sources: &[SourceUnit], crate_name: Option<String>, root: &Path) -> Self {
        let mut resolver = Self {
            rust_modules: BTreeMap::new(),
            python_modules: BTreeMap::new(),
            php_symbols: BTreeMap::new(),
            go_packages: BTreeMap::new(),
            go_module_paths: BTreeSet::new(),
            typescript_files: BTreeSet::new(),
            kotlin_packages: BTreeMap::new(),
            kotlin_symbols: BTreeMap::new(),
            rust_module_by_file: BTreeMap::new(),
            typescript_paths: BTreeMap::new(),
            root: root.to_path_buf(),
            warnings: Vec::new(),
            crate_name,
        };
        let mut config_cache = BTreeMap::new();
        for source in sources {
            match source.parsed.language {
                Some(Language::Rust) => {
                    let module = rust_module_path(&source.id);
                    resolver
                        .rust_module_by_file
                        .insert(source.id.clone(), module.clone());
                    resolver
                        .rust_modules
                        .insert(module.join("::"), source.id.clone());
                }
                Some(Language::Go) => {}
                Some(Language::Python) => resolver.add_python_modules(&source.id),
                Some(Language::Php) => {
                    for symbol in &source.parsed.php_symbols {
                        resolver
                            .php_symbols
                            .insert(normalize_php(symbol), source.id.clone());
                    }
                }
                Some(Language::TypeScript) => {
                    resolver.typescript_files.insert(source.id.clone());
                    if let Some(config_path) = nearest_typescript_config(root, &source.id) {
                        let result = config_cache
                            .entry(config_path.clone())
                            .or_insert_with(|| load_typescript_paths(&config_path));
                        match result {
                            Ok(paths) => {
                                resolver
                                    .typescript_paths
                                    .insert(source.id.clone(), paths.values().cloned().collect());
                            }
                            Err(error) => resolver.warnings.push(format!(
                                "could not read TypeScript path mappings from {}: {error}",
                                config_path.display()
                            )),
                        }
                    }
                }
                Some(Language::Kotlin) => {
                    let package = source.parsed.kotlin_package.as_deref().unwrap_or_default();
                    resolver
                        .kotlin_packages
                        .entry(package.to_owned())
                        .or_default()
                        .insert(source.id.clone());
                    for symbol in &source.parsed.kotlin_symbols {
                        resolver
                            .kotlin_symbols
                            .entry(symbol.clone())
                            .or_insert_with(|| source.id.clone());
                    }
                }
                None => {}
            }
        }
        resolver.add_go_sources(sources, root);
        resolver
    }

    pub fn resolve(&self, source: &SourceUnit, import: &ImportSpec) -> Option<String> {
        match source.parsed.language? {
            Language::Rust => self.resolve_rust(source, import),
            Language::Go => self.resolve_go(import).into_iter().next(),
            Language::Python => self.resolve_python(source, import),
            Language::Php => self.php_symbols.get(&normalize_php(&import.path)).cloned(),
            Language::TypeScript => self.resolve_typescript(source, import),
            Language::Kotlin => self.resolve_kotlin(import).into_iter().next(),
        }
    }

    pub fn resolve_all(&self, source: &SourceUnit, import: &ImportSpec) -> Vec<String> {
        match source.parsed.language {
            Some(Language::Go) => self.resolve_go(import),
            Some(Language::Kotlin) => self.resolve_kotlin(import),
            _ => self.resolve(source, import).into_iter().collect(),
        }
    }

    pub fn is_local_go_import(&self, import: &ImportSpec) -> bool {
        self.go_module_paths.iter().any(|module_path| {
            import.path == module_path.as_str()
                || import
                    .path
                    .strip_prefix(module_path)
                    .is_some_and(|suffix| suffix.starts_with('/'))
        })
    }

    pub fn is_local_typescript_alias(&self, source: &SourceUnit, import: &ImportSpec) -> bool {
        self.typescript_paths.get(&source.id).is_some_and(|paths| {
            paths
                .iter()
                .any(|mapping| path_capture(&mapping.pattern, &import.path).is_some())
        })
    }

    pub fn resolve_rust_module(&self, source: &SourceUnit, import: &ImportSpec) -> Option<String> {
        let parent = Path::new(&source.id).parent()?;
        let file_name = Path::new(&source.id).file_name()?.to_string_lossy();
        let base = if matches!(file_name.as_ref(), "lib.rs" | "main.rs" | "mod.rs") {
            parent.to_path_buf()
        } else {
            parent.join(Path::new(&source.id).file_stem()?)
        };
        if let Some(explicit) = &import.explicit_target {
            let candidate = normalize_relative(&base.join(explicit));
            return self
                .rust_modules
                .values()
                .find(|id| id.as_str() == candidate)
                .cloned();
        }
        let stem = base.join(format!("{}.rs", import.path));
        let module = base.join(&import.path).join("mod.rs");
        [stem, module]
            .into_iter()
            .map(|path| normalize_relative(&path))
            .find(|candidate| self.rust_modules.values().any(|id| id == candidate))
    }

    fn resolve_rust(&self, source: &SourceUnit, import: &ImportSpec) -> Option<String> {
        let current = self.rust_module_by_file.get(&source.id)?;
        let mut segments: Vec<_> = import
            .path
            .trim_start_matches(':')
            .split("::")
            .filter(|part| !part.is_empty() && *part != "*")
            .map(str::to_owned)
            .collect();
        let first = segments.first().map(String::as_str).unwrap_or_default();
        let rooted = matches!(first, "crate" | "self" | "super")
            || self.crate_name.as_deref() == Some(first);
        if first == "crate" || self.crate_name.as_deref() == Some(first) {
            segments.remove(0);
        } else if first == "self" {
            segments.remove(0);
            segments = [current.clone(), segments].concat();
        } else if first == "super" {
            let super_count = import
                .path
                .split("::")
                .take_while(|part| *part == "super")
                .count();
            segments.drain(..super_count);
            let mut base = current.clone();
            for _ in 0..super_count {
                base.pop();
            }
            segments = [base, segments].concat();
        }
        if let Some(target) = self.longest_rust_module(&segments) {
            return Some(target);
        }
        if rooted {
            return None;
        }
        let mut relative = current.clone();
        relative.pop();
        relative.extend(segments.iter().cloned());
        self.longest_rust_module(&relative)
    }

    fn longest_rust_module(&self, segments: &[String]) -> Option<String> {
        for end in (1..=segments.len()).rev() {
            if let Some(target) = self.rust_modules.get(&segments[..end].join("::")) {
                return Some(target.clone());
            }
        }
        None
    }

    fn add_python_modules(&mut self, id: &str) {
        let without_extension = id.strip_suffix(".py").unwrap_or(id);
        let mut parts: Vec<_> = without_extension.split('/').map(str::to_owned).collect();
        if parts.last().is_some_and(|part| part == "__init__") {
            parts.pop();
        }
        add_module_alias(&mut self.python_modules, &parts, id);
        if parts.first().is_some_and(|part| part == "src") {
            add_module_alias(&mut self.python_modules, &parts[1..], id);
        }
    }

    fn add_go_sources(&mut self, sources: &[SourceUnit], root: &Path) {
        let mut module_paths = BTreeMap::new();
        for source in sources
            .iter()
            .filter(|source| source.parsed.language == Some(Language::Go))
        {
            let Some(manifest_path) = nearest_go_module_manifest(root, &source.id) else {
                continue;
            };
            let module_path = module_paths
                .entry(manifest_path.clone())
                .or_insert_with(|| read_go_module_path(&manifest_path))
                .clone();
            let Some(module_path) = module_path else {
                continue;
            };
            let Some(module_root) = manifest_path.parent() else {
                continue;
            };
            let source_directory =
                root.join(Path::new(&source.id).parent().unwrap_or(Path::new("")));
            let Ok(package_directory) = source_directory.strip_prefix(module_root) else {
                continue;
            };
            let package_directory = package_directory.to_string_lossy().replace('\\', "/");
            let package_path = if package_directory.is_empty() || package_directory == "." {
                module_path.clone()
            } else {
                format!("{module_path}/{package_directory}")
            };
            self.go_module_paths.insert(module_path);
            self.go_packages
                .entry(package_path)
                .or_default()
                .insert(source.id.clone());
        }
    }

    fn resolve_go(&self, import: &ImportSpec) -> Vec<String> {
        self.go_packages
            .get(&import.path)
            .map_or_else(Vec::new, |files| files.iter().cloned().collect())
    }

    fn resolve_python(&self, source: &SourceUnit, import: &ImportSpec) -> Option<String> {
        let candidates = import
            .alternatives
            .iter()
            .chain(std::iter::once(&import.path));
        for candidate in candidates {
            let module = python_module_name(candidate, &source.id);
            if let Some(target) = self.python_modules.get(&module) {
                return Some(target.clone());
            }
        }
        None
    }

    fn resolve_typescript(&self, source: &SourceUnit, import: &ImportSpec) -> Option<String> {
        if !matches!(import.path.as_str(), "." | "..")
            && !import.path.starts_with("./")
            && !import.path.starts_with("../")
        {
            return self.resolve_typescript_alias(source, &import.path);
        }
        let parent = Path::new(&source.id).parent()?;
        let base = normalize_project_relative(&parent.join(&import.path))?;
        typescript_candidates(&base)
            .into_iter()
            .find(|candidate| self.typescript_files.contains(candidate))
    }

    fn resolve_typescript_alias(&self, source: &SourceUnit, specifier: &str) -> Option<String> {
        let mappings = self.typescript_paths.get(&source.id)?;
        let mut matching = mappings
            .iter()
            .filter_map(|mapping| {
                path_capture(&mapping.pattern, specifier)
                    .map(|(specificity, capture)| (specificity, mapping, capture))
            })
            .collect::<Vec<_>>();
        matching.sort_by_key(|(specificity, _, _)| std::cmp::Reverse(*specificity));

        for (_, mapping, capture) in matching {
            for target in &mapping.targets {
                let target = target.replace('*', capture);
                let absolute = mapping.base_directory.join(target);
                let Ok(relative) = absolute.strip_prefix(&self.root) else {
                    continue;
                };
                let Some(base) = normalize_project_relative(relative) else {
                    continue;
                };
                if let Some(file) = typescript_candidates(&base)
                    .into_iter()
                    .find(|candidate| self.typescript_files.contains(candidate))
                {
                    return Some(file);
                }
            }
        }
        None
    }

    fn resolve_kotlin(&self, import: &ImportSpec) -> Vec<String> {
        if let Some(package) = import.path.strip_suffix(".*") {
            if let Some(file) = self.kotlin_symbols.get(package) {
                return vec![file.clone()];
            }
            return self
                .kotlin_packages
                .get(package)
                .map_or_else(Vec::new, |files| files.iter().cloned().collect());
        }
        let segments: Vec<_> = import.path.split('.').collect();
        for end in (1..=segments.len()).rev() {
            let symbol = segments[..end].join(".");
            if let Some(file) = self.kotlin_symbols.get(&symbol) {
                return vec![file.clone()];
            }
        }
        if let Some((package, symbol)) = import.path.rsplit_once('.') {
            if let Some(files) = self.kotlin_packages.get(package) {
                if let Some(file) = files.iter().find(|file| {
                    Path::new(file)
                        .file_stem()
                        .is_some_and(|stem| stem == symbol)
                }) {
                    return vec![file.clone()];
                }
            }
        }
        Vec::new()
    }
}

fn path_capture<'a>(pattern: &str, specifier: &'a str) -> Option<(usize, &'a str)> {
    if let Some(wildcard) = pattern.find('*') {
        let prefix = &pattern[..wildcard];
        let suffix = &pattern[wildcard + 1..];
        let middle = specifier.strip_prefix(prefix)?.strip_suffix(suffix)?;
        if middle.len() + prefix.len() + suffix.len() != specifier.len() {
            return None;
        }
        Some((prefix.len() + suffix.len(), middle))
    } else if pattern == specifier {
        Some((usize::MAX, ""))
    } else {
        None
    }
}

fn nearest_go_module_manifest(root: &Path, source_id: &str) -> Option<PathBuf> {
    let mut directory = root.join(Path::new(source_id).parent()?);
    loop {
        let candidate = directory.join("go.mod");
        if candidate.is_file() {
            return Some(candidate);
        }
        if !directory.pop() {
            return None;
        }
    }
}

fn read_go_module_path(manifest_path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(manifest_path).ok()?;
    for line in content.lines() {
        let mut fields = line.split_whitespace();
        if fields.next() == Some("module") {
            let module_path = fields
                .next()?
                .trim_matches(|character| matches!(character, '"' | '`'))
                .to_owned();
            if !module_path.is_empty() {
                return Some(module_path);
            }
        }
    }
    None
}

fn nearest_typescript_config(root: &Path, source_id: &str) -> Option<PathBuf> {
    let mut directory = root.join(Path::new(source_id).parent()?);
    loop {
        for name in ["tsconfig.app.json", "tsconfig.json", "jsconfig.json"] {
            let candidate = directory.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        if directory == root || !directory.pop() {
            return None;
        }
    }
}

fn load_typescript_paths(
    config_path: &Path,
) -> Result<BTreeMap<String, TypeScriptPathMapping>, String> {
    let config_path = std::fs::canonicalize(config_path).map_err(|error| error.to_string())?;
    load_typescript_paths_inner(&config_path, &mut BTreeSet::new())
}

fn load_typescript_paths_inner(
    config_path: &Path,
    visited: &mut BTreeSet<PathBuf>,
) -> Result<BTreeMap<String, TypeScriptPathMapping>, String> {
    if !visited.insert(config_path.to_path_buf()) {
        return Err("circular tsconfig extends chain".to_owned());
    }
    let content = std::fs::read_to_string(config_path).map_err(|error| error.to_string())?;
    let config: TypeScriptConfig =
        serde_json::from_str(&strip_json_comments(&content)).map_err(|error| error.to_string())?;
    let mut mappings = if let Some(parent) = &config.extends {
        let parent_path = resolve_extended_config(config_path, parent)
            .ok_or_else(|| format!("cannot resolve extended config `{parent}`"))?;
        load_typescript_paths_inner(&parent_path, visited)?
    } else {
        BTreeMap::new()
    };

    if let Some(options) = config.compiler_options {
        let base_directory = config_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(options.base_url.as_deref().unwrap_or("."));
        if let Some(paths) = options.paths {
            for (pattern, targets) in paths {
                mappings.insert(
                    pattern.clone(),
                    TypeScriptPathMapping {
                        pattern,
                        targets,
                        base_directory: base_directory.clone(),
                    },
                );
            }
        }
    }
    visited.remove(config_path);
    Ok(mappings)
}

fn resolve_extended_config(config_path: &Path, extends: &str) -> Option<PathBuf> {
    let extends = Path::new(extends);
    let parent = config_path.parent()?;
    let base = if extends.is_absolute() {
        extends.to_path_buf()
    } else if extends.to_string_lossy().starts_with('.') {
        parent.join(extends)
    } else {
        let mut current = Some(parent);
        let mut found = None;
        while let Some(directory) = current {
            let candidate = directory.join("node_modules").join(extends);
            if candidate.exists() {
                found = Some(candidate);
                break;
            }
            current = directory.parent();
        }
        found?
    };
    let candidates = if base.extension().is_some() {
        vec![base]
    } else {
        vec![base.with_extension("json"), base.join("tsconfig.json")]
    };
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn strip_json_comments(input: &str) -> String {
    let characters = input.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(input.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;
    while index < characters.len() {
        let character = characters[index];
        if in_string {
            output.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            index += 1;
        } else if character == '"' {
            in_string = true;
            output.push(character);
            index += 1;
        } else if character == '/' && characters.get(index + 1) == Some(&'/') {
            while index < characters.len() && characters[index] != '\n' {
                output.push(' ');
                index += 1;
            }
        } else if character == '/' && characters.get(index + 1) == Some(&'*') {
            output.push_str("  ");
            index += 2;
            while index < characters.len() {
                if characters[index] == '*' && characters.get(index + 1) == Some(&'/') {
                    output.push_str("  ");
                    index += 2;
                    break;
                }
                output.push(if characters[index] == '\n' { '\n' } else { ' ' });
                index += 1;
            }
        } else {
            output.push(character);
            index += 1;
        }
    }

    let characters = output.chars().collect::<Vec<_>>();
    let mut without_trailing_commas = String::with_capacity(output.len());
    for (index, character) in characters.iter().enumerate() {
        if *character == ',' {
            let next = characters[index + 1..]
                .iter()
                .find(|character| !character.is_whitespace());
            if matches!(next, Some('}' | ']')) {
                continue;
            }
        }
        without_trailing_commas.push(*character);
    }
    without_trailing_commas
}

fn typescript_candidates(base: &str) -> Vec<String> {
    let mut candidates = vec![base.to_owned()];
    let index_extensions = [".ts", ".tsx", ".mts", ".cts", ".d.ts"];
    let substitutions: &[&str] = if base.ends_with(".mjs") {
        &[".mts", ".ts"]
    } else if base.ends_with(".cjs") {
        &[".cts", ".ts"]
    } else if base.ends_with(".jsx") {
        &[".tsx", ".ts"]
    } else if base.ends_with(".js") {
        &[".ts", ".tsx", ".d.ts"]
    } else {
        &[]
    };
    if !substitutions.is_empty() {
        let extension = [".mjs", ".cjs", ".jsx", ".js"]
            .into_iter()
            .find(|extension| base.ends_with(extension))
            .unwrap_or_default();
        let stem = base.trim_end_matches(extension);
        candidates.extend(
            substitutions
                .iter()
                .map(|extension| format!("{stem}{extension}")),
        );
    } else if ![".ts", ".tsx", ".mts", ".cts"]
        .iter()
        .any(|extension| base.ends_with(extension))
    {
        candidates.extend(
            index_extensions
                .iter()
                .map(|extension| format!("{base}{extension}")),
        );
    }
    for extension in index_extensions {
        candidates.push(format!("{base}/index{extension}"));
    }
    candidates
}

fn normalize_project_relative(path: &Path) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                parts.pop()?;
            }
            std::path::Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            _ => return None,
        }
    }
    Some(parts.join("/"))
}

fn add_module_alias(index: &mut BTreeMap<String, String>, parts: &[String], id: &str) {
    if !parts.is_empty() {
        index
            .entry(parts.join("."))
            .or_insert_with(|| id.to_owned());
    }
}

fn python_module_name(path: &str, source_id: &str) -> String {
    let relative_levels = path
        .chars()
        .take_while(|character| *character == '.')
        .count();
    let path = path.trim_start_matches('.');
    let mut parts: Vec<String> = if relative_levels == 0 {
        Vec::new()
    } else {
        let mut package: Vec<_> = source_id
            .split('/')
            .take(source_id.split('/').count().saturating_sub(1))
            .map(str::to_owned)
            .collect();
        if package.last().is_some_and(|part| part == "src") {
            package.remove(0);
        }
        for _ in 1..relative_levels {
            package.pop();
        }
        package
    };
    parts.extend(
        path.split('.')
            .filter(|part| !part.is_empty())
            .map(str::to_owned),
    );
    parts.join(".")
}

fn rust_module_path(id: &str) -> Vec<String> {
    let mut parts: Vec<_> = id.split('/').map(str::to_owned).collect();
    if parts.first().is_some_and(|part| part == "src") {
        parts.remove(0);
    }
    if let Some(file) = parts.pop() {
        if !matches!(file.as_str(), "lib.rs" | "main.rs" | "mod.rs") {
            parts.push(file.trim_end_matches(".rs").to_owned());
        }
    }
    parts
}

fn normalize_php(name: &str) -> String {
    name.trim()
        .trim_start_matches('\\')
        .replace('/', "\\")
        .to_ascii_lowercase()
}

fn normalize_relative(path: &Path) -> String {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                parts.pop();
            }
            std::path::Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            _ => {}
        }
    }
    parts.join("/")
}
