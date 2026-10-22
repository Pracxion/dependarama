use super::{ImportSpec, ParsedSource};
use crate::graph::EdgeKind;
use tree_sitter::{Language, Node, Parser};

pub fn parse(source: &str) -> Result<ParsedSource, String> {
    let language: Language = tree_sitter_go::LANGUAGE.into();
    let mut parser = Parser::new();
    parser
        .set_language(&language)
        .map_err(|error| error.to_string())?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "tree-sitter could not parse Go source".to_owned())?;
    let mut parsed = ParsedSource {
        has_parse_errors: tree.root_node().has_error(),
        ..ParsedSource::default()
    };
    collect_imports(tree.root_node(), source, &mut parsed.imports);
    Ok(parsed)
}

fn collect_imports(node: Node<'_>, source: &str, imports: &mut Vec<ImportSpec>) {
    if node.kind() == "import_spec" {
        if let Some(path) = node
            .child_by_field_name("path")
            .and_then(|path| string_value(path, source))
        {
            imports.push(ImportSpec {
                path,
                alternatives: Vec::new(),
                line: node.start_position().row + 1,
                kind: EdgeKind::Import,
                explicit_target: None,
            });
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect_imports(child, source, imports);
    }
}

fn string_value(node: Node<'_>, source: &str) -> Option<String> {
    let literal = text(node, source);
    match node.kind() {
        "interpreted_string_literal" => {
            let value = literal.strip_prefix('"')?.strip_suffix('"')?;
            Some(value.replace("\\\\", "\\").replace("\\\"", "\""))
        }
        "raw_string_literal" => Some(
            literal
                .strip_prefix('`')?
                .strip_suffix('`')?
                .replace('\r', ""),
        ),
        _ => None,
    }
}

fn text<'a>(node: Node<'_>, source: &'a str) -> &'a str {
    source.get(node.byte_range()).unwrap_or_default()
}
