use super::{ImportSpec, ParsedSource};
use crate::graph::EdgeKind;
use std::path::Path;
use tree_sitter::{Language, Node, Parser};

pub fn parse(path: &Path, source: &str) -> Result<ParsedSource, String> {
    let is_tsx = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("tsx"));
    let language: Language = if is_tsx {
        tree_sitter_typescript::LANGUAGE_TSX.into()
    } else {
        tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
    };
    let mut parser = Parser::new();
    parser
        .set_language(&language)
        .map_err(|error| error.to_string())?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "tree-sitter could not parse TypeScript source".to_owned())?;
    let mut parsed = ParsedSource {
        has_parse_errors: tree.root_node().has_error(),
        ..ParsedSource::default()
    };
    collect_imports(tree.root_node(), source, &mut parsed.imports);
    Ok(parsed)
}

fn collect_imports(node: Node<'_>, source: &str, imports: &mut Vec<ImportSpec>) {
    match node.kind() {
        "import_statement" => add_module_reference(node, EdgeKind::Import, source, imports),
        "export_statement" => add_module_reference(node, EdgeKind::ReExport, source, imports),
        "call_expression" => add_dynamic_import(node, source, imports),
        _ => {}
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect_imports(child, source, imports);
    }
}

fn add_module_reference(
    node: Node<'_>,
    kind: EdgeKind,
    source: &str,
    imports: &mut Vec<ImportSpec>,
) {
    let Some(module) = node
        .child_by_field_name("source")
        .and_then(|node| string_value(node, source))
    else {
        return;
    };
    imports.push(import(module, node, kind));
}

fn add_dynamic_import(node: Node<'_>, source: &str, imports: &mut Vec<ImportSpec>) {
    let is_import = node
        .child_by_field_name("function")
        .is_some_and(|function| text(function, source) == "import");
    if !is_import {
        return;
    }
    let Some(module) = node
        .child_by_field_name("arguments")
        .and_then(|arguments| arguments.named_child(0))
        .and_then(|argument| string_value(argument, source))
    else {
        return;
    };
    imports.push(import(module, node, EdgeKind::Import));
}

fn import(path: String, node: Node<'_>, kind: EdgeKind) -> ImportSpec {
    ImportSpec {
        path,
        alternatives: Vec::new(),
        line: node.start_position().row + 1,
        kind,
        explicit_target: None,
    }
}

fn string_value(node: Node<'_>, source: &str) -> Option<String> {
    if node.kind() != "string" {
        return None;
    }
    let literal = text(node, source);
    let quote = literal.chars().next()?;
    if !matches!(quote, '\'' | '"')
        || literal.len() < quote.len_utf8() * 2
        || !literal.ends_with(quote)
    {
        return None;
    }
    Some(literal[quote.len_utf8()..literal.len() - quote.len_utf8()].to_owned())
}

fn text<'a>(node: Node<'_>, source: &'a str) -> &'a str {
    source.get(node.byte_range()).unwrap_or_default()
}
