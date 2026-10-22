use crate::graph::ConfiguredDomain;
use serde::Deserialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct Settings {
    pub graphs: Vec<GraphSettings>,
}

#[derive(Debug)]
pub struct GraphSettings {
    pub id: String,
    pub name: String,
    pub group: Option<String>,
    pub root: PathBuf,
    pub starts: Vec<PathBuf>,
    pub domains: Vec<ConfiguredDomain>,
    pub ignored_directories: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
struct Config {
    #[serde(default)]
    common: CommonConfig,
    graph: Option<GraphConfig>,
    #[serde(default)]
    graphs: Vec<GraphConfig>,
}

#[derive(Debug, Deserialize, Default)]
struct CommonConfig {
    #[serde(default)]
    ignored_directories: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GraphConfig {
    id: Option<String>,
    name: Option<String>,
    group: Option<String>,
    #[serde(default = "default_root")]
    crate_root: String,
    #[serde(default)]
    starts: Vec<String>,
    #[serde(default)]
    domains: Vec<ConfiguredDomain>,
}

impl Default for GraphConfig {
    fn default() -> Self {
        Self {
            id: None,
            name: None,
            group: None,
            crate_root: default_root(),
            starts: Vec::new(),
            domains: Vec::new(),
        }
    }
}

fn default_root() -> String {
    ".".to_owned()
}

pub fn load(config_path: Option<&Path>, root_override: Option<&Path>) -> Result<Settings, String> {
    let config_path = config_path.map(Path::to_path_buf).unwrap_or_else(|| {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let local_config = manifest_dir.join("config.toml");
        if local_config.is_file() {
            local_config
        } else {
            manifest_dir.join("config.example.toml")
        }
    });
    let config_path = absolute_path(
        &config_path,
        &std::env::current_dir().map_err(display_error)?,
    )?;
    let content = std::fs::read_to_string(&config_path)
        .map_err(|error| format!("cannot read {}: {error}", config_path.display()))?;
    let config: Config = toml::from_str(&content)
        .map_err(|error| format!("invalid config {}: {error}", config_path.display()))?;
    let ignored_directories = normalize_ignored_directories(config.common.ignored_directories)?;

    let config_dir = config_path
        .parent()
        .ok_or_else(|| format!("config path has no parent: {}", config_path.display()))?;
    let configured_graphs = match (config.graph, config.graphs.is_empty()) {
        (Some(graph), true) => vec![graph],
        (None, true) => vec![GraphConfig::default()],
        (Some(_), false) => {
            return Err("use either [graph] or [[graphs]] entries, not both".to_owned());
        }
        (None, false) => config.graphs,
    };
    if root_override.is_some() && configured_graphs.len() > 1 {
        return Err("--root can only be used when the config defines one graph".to_owned());
    }

    let mut graphs = Vec::with_capacity(configured_graphs.len());
    let mut graph_ids = BTreeSet::new();
    let mut graph_names = BTreeSet::new();
    for (index, mut graph) in configured_graphs.into_iter().enumerate() {
        let root = match root_override {
            Some(root) => absolute_path(root, &std::env::current_dir().map_err(display_error)?)?,
            None => absolute_path(Path::new(&graph.crate_root), config_dir)?,
        };
        if !root.is_dir() {
            return Err(format!(
                "project root is not a directory: {}",
                root.display()
            ));
        }

        let name = graph.name.take().unwrap_or_else(|| {
            root.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("project")
                .to_owned()
        });
        let name = name.trim().to_owned();
        if name.is_empty() {
            return Err("configured graph names must not be empty".to_owned());
        }
        if !graph_names.insert(name.clone()) {
            return Err(format!("duplicate configured graph name: {name}"));
        }
        let group = graph.group.take().map(|group| group.trim().to_owned());
        if group.as_deref() == Some("") {
            return Err(format!(
                "configured graph group for {name} must not be empty"
            ));
        }
        let id = graph.id.take().unwrap_or_else(|| graph_id(&name, index));
        let id = id.trim().to_owned();
        if id.is_empty() {
            return Err(format!("configured graph id for {name} must not be empty"));
        }
        if !graph_ids.insert(id.clone()) {
            return Err(format!("duplicate configured graph id: {id}"));
        }

        let starts = normalize_starts(graph.starts, &root)?;
        let domains = normalize_domains(graph.domains, &root)?;
        graphs.push(GraphSettings {
            id,
            name,
            group,
            root,
            starts,
            domains,
            ignored_directories: ignored_directories.clone(),
        });
    }

    Ok(Settings { graphs })
}

fn normalize_ignored_directories(directories: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = BTreeSet::new();
    for directory in directories {
        let directory = directory.trim();
        if directory.is_empty()
            || directory == "."
            || directory == ".."
            || directory.contains('/')
            || directory.contains('\\')
        {
            return Err(format!(
                "ignored directories must be directory names, not paths: {directory}"
            ));
        }
        normalized.insert(directory.to_owned());
    }
    Ok(normalized.into_iter().collect())
}

fn normalize_starts(starts: Vec<String>, root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut normalized = Vec::new();
    let mut seen = BTreeSet::new();
    for start in starts {
        let start = start.trim();
        if start.is_empty() {
            return Err("graph start paths must not be empty".to_owned());
        }
        let path = Path::new(start);
        if path.is_absolute() {
            return Err(format!(
                "graph start paths must be relative to crate_root: {start}"
            ));
        }
        let resolved = absolute_path(path, root)?;
        let relative = resolved
            .strip_prefix(root)
            .map_err(|_| format!("graph start path must stay inside crate_root: {start}"))?;
        if relative.as_os_str().is_empty() {
            return Err("use an empty starts list to scan the entire crate_root".to_owned());
        }
        if !resolved.is_dir()
            && (!resolved.is_file()
                || crate::parser::Language::from_path_for_scan(&resolved).is_none())
        {
            return Err(format!(
                "graph start must be a source file or directory: {start}"
            ));
        }
        if seen.insert(resolved.clone()) {
            normalized.push(resolved);
        }
    }
    Ok(normalized)
}

fn normalize_domains(
    configured_domains: Vec<ConfiguredDomain>,
    root: &Path,
) -> Result<Vec<ConfiguredDomain>, String> {
    let mut domains: Vec<ConfiguredDomain> = Vec::new();
    for mut domain in configured_domains {
        domain.name = domain.name.trim().to_owned();
        if domain.name.is_empty() {
            return Err("configured domains must have a non-empty name".to_owned());
        }
        if domains.iter().any(|existing| existing.name == domain.name) {
            return Err(format!("duplicate configured domain name: {}", domain.name));
        }
        let path = Path::new(domain.path.trim());
        if path.is_absolute() {
            return Err(format!(
                "domain paths must be relative to crate_root: {}",
                domain.path
            ));
        }
        let resolved = absolute_path(path, root)?;
        let relative = resolved
            .strip_prefix(root)
            .map_err(|_| format!("domain path must stay inside crate_root: {}", domain.path))?;
        if relative.as_os_str().is_empty() || !resolved.is_dir() {
            return Err(format!(
                "configured domain directory does not exist: {}",
                domain.path
            ));
        }
        domain.path = relative.to_string_lossy().replace('\\', "/");
        if domains.iter().any(|existing| existing.path == domain.path) {
            return Err(format!("duplicate configured domain path: {}", domain.path));
        }
        domains.push(domain);
    }
    Ok(domains)
}

fn graph_id(name: &str, index: usize) -> String {
    let mut result = String::new();
    let mut separator = false;
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            if separator && !result.is_empty() {
                result.push('-');
            }
            result.push(character.to_ascii_lowercase());
            separator = false;
        } else {
            separator = true;
        }
    }
    if result.is_empty() {
        format!("graph-{}", index + 1)
    } else {
        result
    }
}

fn absolute_path(path: &Path, base: &Path) -> Result<PathBuf, String> {
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    };
    std::fs::canonicalize(&joined)
        .map_err(|error| format!("cannot resolve {}: {error}", joined.display()))
}

fn display_error(error: std::io::Error) -> String {
    error.to_string()
}
