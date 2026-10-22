use super::{ImportSpec, ParsedSource};
use crate::graph::EdgeKind;
use syn::spanned::Spanned;
use syn::{Attribute, Item, ItemMod, UseTree};

pub fn parse(source: &str) -> Result<ParsedSource, String> {
    let file = syn::parse_file(source).map_err(|error| error.to_string())?;
    let mut parsed = ParsedSource::default();
    collect_items(&file.items, &mut parsed.imports);
    Ok(parsed)
}

fn collect_items(items: &[Item], imports: &mut Vec<ImportSpec>) {
    for item in items {
        match item {
            Item::Use(item) => {
                let kind = if matches!(item.vis, syn::Visibility::Public(_)) {
                    EdgeKind::ReExport
                } else {
                    EdgeKind::Import
                };
                let prefix = if item.leading_colon.is_some() {
                    "::"
                } else {
                    ""
                };
                let mut paths = Vec::new();
                flatten_use_tree(&item.tree, prefix.to_owned(), &mut paths);
                let line = item.span().start().line.max(1);
                imports.extend(paths.into_iter().map(|path| ImportSpec {
                    path,
                    alternatives: Vec::new(),
                    line,
                    kind,
                    explicit_target: None,
                }));
            }
            Item::Mod(item) => collect_module(item, imports),
            _ => {}
        }
    }
}

fn collect_module(item: &ItemMod, imports: &mut Vec<ImportSpec>) {
    if let Some((_, items)) = &item.content {
        collect_items(items, imports);
        return;
    }
    let explicit_target = path_attribute(&item.attrs);
    imports.push(ImportSpec {
        path: item.ident.to_string(),
        alternatives: Vec::new(),
        line: item.span().start().line.max(1),
        kind: EdgeKind::Module,
        explicit_target,
    });
}

fn path_attribute(attributes: &[Attribute]) -> Option<String> {
    attributes.iter().find_map(|attribute| {
        if !attribute.path().is_ident("path") {
            return None;
        }
        match &attribute.meta {
            syn::Meta::NameValue(value) => match &value.value {
                syn::Expr::Lit(expression) => match &expression.lit {
                    syn::Lit::Str(path) => Some(path.value()),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        }
    })
}

fn flatten_use_tree(tree: &UseTree, prefix: String, output: &mut Vec<String>) {
    match tree {
        UseTree::Path(path) => {
            let next = append_path(&prefix, &path.ident.to_string());
            flatten_use_tree(&path.tree, next, output);
        }
        UseTree::Name(name) => {
            if name.ident == "self" && !prefix.is_empty() {
                output.push(prefix);
            } else {
                output.push(append_path(&prefix, &name.ident.to_string()));
            }
        }
        UseTree::Rename(rename) => {
            if rename.ident == "self" && !prefix.is_empty() {
                output.push(prefix);
            } else {
                output.push(append_path(&prefix, &rename.ident.to_string()));
            }
        }
        UseTree::Glob(_) => output.push(append_path(&prefix, "*")),
        UseTree::Group(group) => {
            for item in &group.items {
                flatten_use_tree(item, prefix.clone(), output);
            }
        }
    }
}

fn append_path(prefix: &str, segment: &str) -> String {
    if prefix.is_empty() || prefix == "::" {
        format!("{prefix}{segment}")
    } else {
        format!("{prefix}::{segment}")
    }
}
