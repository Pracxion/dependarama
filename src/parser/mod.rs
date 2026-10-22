mod go;
mod kotlin;
mod php;
mod python;
mod rust;
mod typescript;

use crate::graph::EdgeKind;
use std::path::Path;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Language {
    Rust,
    Go,
    Php,
    Python,
    TypeScript,
    Kotlin,
}

impl Language {
    pub fn name(self) -> &'static str {
        match self {
            Self::Rust => "rust",
            Self::Go => "go",
            Self::Php => "php",
            Self::Python => "python",
            Self::TypeScript => "typescript",
            Self::Kotlin => "kotlin",
        }
    }

    pub fn from_path_for_scan(path: &Path) -> Option<Self> {
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "rs" => Some(Self::Rust),
            "go" => Some(Self::Go),
            "php" => Some(Self::Php),
            "py" => Some(Self::Python),
            "ts" | "tsx" | "mts" | "cts" => Some(Self::TypeScript),
            "kt" | "kts" => Some(Self::Kotlin),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ImportSpec {
    pub path: String,
    pub alternatives: Vec<String>,
    pub line: usize,
    pub kind: EdgeKind,
    pub explicit_target: Option<String>,
}

#[derive(Debug, Default)]
pub struct ParsedSource {
    pub language: Option<Language>,
    pub imports: Vec<ImportSpec>,
    pub php_namespace: Option<String>,
    pub php_symbols: Vec<String>,
    pub kotlin_package: Option<String>,
    pub kotlin_symbols: Vec<String>,
    pub has_parse_errors: bool,
}

pub fn parse(path: &Path, source: &str) -> Result<ParsedSource, String> {
    let Some(language) = Language::from_path_for_scan(path) else {
        return Err(format!("unsupported source file: {}", path.display()));
    };
    let mut parsed = match language {
        Language::Rust => rust::parse(source)?,
        Language::Go => go::parse(source)?,
        Language::Php => php::parse(source)?,
        Language::Python => python::parse(source)?,
        Language::TypeScript => typescript::parse(path, source)?,
        Language::Kotlin => kotlin::parse(source)?,
    };
    parsed.language = Some(language);
    Ok(parsed)
}
