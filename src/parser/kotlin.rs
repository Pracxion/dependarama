use super::{ImportSpec, ParsedSource};
use crate::graph::EdgeKind;
use tree_sitter::{Language, Node, Parser};

pub fn parse(source: &str) -> Result<ParsedSource, String> {
    let language: Language = tree_sitter_kotlin_ng::LANGUAGE.into();
    let mut parser = Parser::new();
    parser
        .set_language(&language)
        .map_err(|error| error.to_string())?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "tree-sitter could not parse Kotlin source".to_owned())?;
    let mut parsed = ParsedSource {
        has_parse_errors: tree.root_node().has_error(),
        ..ParsedSource::default()
    };
    collect_file_items(tree.root_node(), source, &mut parsed);
    Ok(parsed)
}

fn collect_file_items(root: Node<'_>, source: &str, parsed: &mut ParsedSource) {
    let mut cursor = root.walk();
    for child in root.named_children(&mut cursor) {
        match child.kind() {
            "package_header" => {
                let package = text(child, source)
                    .trim()
                    .strip_prefix("package")
                    .unwrap_or_default()
                    .trim();
                let package = normalize_path(package);
                parsed.kotlin_package = (!package.is_empty()).then_some(package);
            }
            "import" => add_import(child, source, &mut parsed.imports),
            _ => collect_top_level_symbols(child, source, &mut parsed.kotlin_symbols),
        }
    }
    let package = parsed.kotlin_package.as_deref().unwrap_or_default();
    for symbol in &mut parsed.kotlin_symbols {
        if !package.is_empty() {
            *symbol = format!("{package}.{symbol}");
        }
    }
}

fn add_import(node: Node<'_>, source: &str, imports: &mut Vec<ImportSpec>) {
    let Some(path) = text(node, source)
        .trim()
        .strip_prefix("import")
        .map(str::trim)
    else {
        return;
    };
    let path = path
        .split_once(" as ")
        .map_or(path, |(path, _)| path)
        .trim();
    let path = normalize_path(path);
    if path.is_empty() {
        return;
    }
    imports.push(ImportSpec {
        path,
        alternatives: Vec::new(),
        line: node.start_position().row + 1,
        kind: EdgeKind::Import,
        explicit_target: None,
    });
}

fn collect_top_level_symbols(node: Node<'_>, source: &str, symbols: &mut Vec<String>) {
    match node.kind() {
        "class_declaration" | "function_declaration" | "object_declaration" => {
            if let Some(name) = node.child_by_field_name("name") {
                symbols.push(text(name, source).to_owned());
            }
        }
        "type_alias" => {
            if let Some(name) = node.child_by_field_name("type") {
                symbols.push(text(name, source).to_owned());
            }
        }
        "property_declaration" => {
            let mut cursor = node.walk();
            for declaration in node.named_children(&mut cursor) {
                if declaration.kind() != "variable_declaration" {
                    continue;
                }
                let name = {
                    let mut declaration_cursor = declaration.walk();
                    let name = declaration
                        .named_children(&mut declaration_cursor)
                        .find(|child| child.kind() == "identifier")
                        .map(|name| text(name, source).to_owned());
                    name
                };
                if let Some(name) = name {
                    symbols.push(name);
                }
            }
        }
        "declaration" | "statement" => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                collect_top_level_symbols(child, source, symbols);
            }
        }
        _ => {}
    }
}

fn normalize_path(path: &str) -> String {
    path.trim()
        .trim_end_matches(';')
        .split('.')
        .map(|part| part.trim().trim_matches('`'))
        .collect::<Vec<_>>()
        .join(".")
}

fn text<'a>(node: Node<'_>, source: &'a str) -> &'a str {
    source.get(node.byte_range()).unwrap_or_default()
}
