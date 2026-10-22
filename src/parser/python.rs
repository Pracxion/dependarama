use super::{ImportSpec, ParsedSource};
use crate::graph::EdgeKind;
use tree_sitter::{Language, Node, Parser};

pub fn parse(source: &str) -> Result<ParsedSource, String> {
    let language: Language = tree_sitter_python::LANGUAGE.into();
    let tree = parse_tree(language, source)?;
    let mut parsed = ParsedSource {
        has_parse_errors: tree.root_node().has_error(),
        ..ParsedSource::default()
    };
    collect_imports(tree.root_node(), source, &mut parsed.imports);
    Ok(parsed)
}

fn parse_tree(language: Language, source: &str) -> Result<tree_sitter::Tree, String> {
    let mut parser = Parser::new();
    parser
        .set_language(&language)
        .map_err(|error| error.to_string())?;
    parser
        .parse(source, None)
        .ok_or_else(|| "tree-sitter could not parse Python source".to_owned())
}

fn collect_imports(node: Node<'_>, source: &str, imports: &mut Vec<ImportSpec>) {
    match node.kind() {
        "import_statement" => add_imports(source_slice(node, source), node, imports),
        "import_from_statement" => add_from_imports(source_slice(node, source), node, imports),
        _ => {}
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect_imports(child, source, imports);
    }
}

fn add_imports(statement: &str, node: Node<'_>, imports: &mut Vec<ImportSpec>) {
    let Some(names) = statement.trim().strip_prefix("import") else {
        return;
    };
    for name in names
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        let path = name
            .split_once(" as ")
            .map_or(name, |(path, _)| path)
            .trim();
        if !path.is_empty() {
            imports.push(import(path.to_owned(), Vec::new(), node));
        }
    }
}

fn add_from_imports(statement: &str, node: Node<'_>, imports: &mut Vec<ImportSpec>) {
    let Some(rest) = statement.trim().strip_prefix("from") else {
        return;
    };
    let Some((module, imported)) = rest.split_once("import") else {
        return;
    };
    let module = module.trim();
    if module.is_empty() {
        return;
    }
    let imported = imported
        .trim()
        .trim_start_matches('(')
        .trim_end_matches(')');
    let members: Vec<_> = imported
        .split(',')
        .map(str::trim)
        .map(|name| {
            name.split_once(" as ")
                .map_or(name, |(name, _)| name)
                .trim()
        })
        .filter(|name| !name.is_empty() && *name != "*")
        .collect();
    let alternatives = members
        .iter()
        .map(|member| format!("{}.{}", module, member))
        .collect();
    imports.push(import(module.to_owned(), alternatives, node));
}

fn import(path: String, alternatives: Vec<String>, node: Node<'_>) -> ImportSpec {
    ImportSpec {
        path,
        alternatives,
        line: node.start_position().row + 1,
        kind: EdgeKind::Import,
        explicit_target: None,
    }
}

fn source_slice<'a>(node: Node<'_>, source: &'a str) -> &'a str {
    source.get(node.byte_range()).unwrap_or_default()
}
