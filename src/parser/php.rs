use super::{ImportSpec, ParsedSource};
use crate::graph::EdgeKind;
use tree_sitter::{Language, Node, Parser};

pub fn parse(source: &str) -> Result<ParsedSource, String> {
    let language: Language = tree_sitter_php::LANGUAGE_PHP.into();
    let mut parser = Parser::new();
    parser
        .set_language(&language)
        .map_err(|error| error.to_string())?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "tree-sitter could not parse PHP source".to_owned())?;
    let mut parsed = ParsedSource {
        has_parse_errors: tree.root_node().has_error(),
        ..ParsedSource::default()
    };
    collect_program(tree.root_node(), source, &mut parsed);
    Ok(parsed)
}

fn collect_program(root: Node<'_>, source: &str, parsed: &mut ParsedSource) {
    let mut namespace = String::new();
    let mut cursor = root.walk();
    for child in root.named_children(&mut cursor) {
        if child.kind() == "namespace_definition" {
            let name = namespace_name(child, source);
            parsed.php_namespace = (!name.is_empty()).then(|| name.clone());
            if let Some(body) = child.child_by_field_name("body") {
                collect(body, source, &name, parsed);
            } else {
                namespace = name;
            }
        } else {
            collect(child, source, &namespace, parsed);
        }
    }
}

fn collect(node: Node<'_>, source: &str, namespace: &str, parsed: &mut ParsedSource) {
    if node.kind() == "namespace_use_declaration" {
        add_use_declaration(text(node, source), node, &mut parsed.imports);
    }
    if matches!(
        node.kind(),
        "class_declaration"
            | "interface_declaration"
            | "trait_declaration"
            | "enum_declaration"
            | "function_definition"
    ) {
        if let Some(name) = node.child_by_field_name("name") {
            let name = text(name, source).trim();
            if !name.is_empty() {
                parsed.php_symbols.push(qualified(namespace, name));
            }
        }
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect(child, source, namespace, parsed);
    }
}

fn namespace_name(node: Node<'_>, source: &str) -> String {
    node.child_by_field_name("name")
        .map(|name| text(name, source).trim().to_owned())
        .or_else(|| {
            let mut cursor = node.walk();
            let name = node
                .named_children(&mut cursor)
                .find(|child| child.kind() == "namespace_name")
                .map(|name| text(name, source).trim().to_owned());
            name
        })
        .unwrap_or_default()
}

fn add_use_declaration(statement: &str, node: Node<'_>, imports: &mut Vec<ImportSpec>) {
    let Some(body) = statement.trim().strip_prefix("use") else {
        return;
    };
    let mut body = body.trim().trim_end_matches(';').trim();
    if body.starts_with("function ") || body.starts_with("const ") {
        body = body.split_once(' ').map_or(body, |(_, rest)| rest.trim());
    }
    if let Some((prefix, group)) = body.split_once('{') {
        let prefix = prefix.trim().trim_end_matches('\\');
        let group = group.trim_end_matches('}').trim();
        for name in group
            .split(',')
            .map(str::trim)
            .filter(|name| !name.is_empty())
        {
            let name = strip_alias(name);
            let path = join_name(prefix, name);
            imports.push(import(path, node));
        }
    } else {
        for name in body
            .split(',')
            .map(str::trim)
            .filter(|name| !name.is_empty())
        {
            imports.push(import(strip_alias(name).to_owned(), node));
        }
    }
}

fn strip_alias(name: &str) -> &str {
    name.split_once(" as ")
        .map_or(name, |(name, _)| name)
        .trim()
}

fn join_name(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.trim_start_matches('\\').to_owned()
    } else {
        format!(
            "{}\\{}",
            prefix.trim_matches('\\'),
            name.trim_start_matches('\\')
        )
    }
}

fn qualified(namespace: &str, name: &str) -> String {
    join_name(namespace, name)
}

fn import(path: String, node: Node<'_>) -> ImportSpec {
    ImportSpec {
        path,
        alternatives: Vec::new(),
        line: node.start_position().row + 1,
        kind: EdgeKind::Import,
        explicit_target: None,
    }
}

fn text<'a>(node: Node<'_>, source: &'a str) -> &'a str {
    source.get(node.byte_range()).unwrap_or_default()
}
