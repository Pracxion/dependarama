use serde::Deserialize;
use serde::Serialize;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ConfiguredDomain {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct DependencyGraph {
    pub id: String,
    pub name: String,
    pub group: Option<String>,
    pub domains: Vec<ConfiguredDomain>,
    pub nodes: Vec<SourceFile>,
    pub edges: Vec<ImportEdge>,
    pub unresolved: Vec<UnresolvedImport>,
    pub warnings: Vec<String>,
    pub limitations: String,
}

#[derive(Debug, Serialize)]
pub struct DependencyGraphCollection<'a> {
    pub graphs: &'a [DependencyGraph],
}

#[derive(Debug, Serialize)]
pub struct SourceFile {
    pub id: String,
    pub domain: Option<String>,
    pub language: String,
    pub content: String,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EdgeKind {
    Import,
    ReExport,
    Module,
}

impl EdgeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Import => "import",
            Self::ReExport => "re-export",
            Self::Module => "module",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ImportEdge {
    pub source: String,
    pub target: String,
    pub kind: EdgeKind,
    pub references: Vec<ImportReference>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct ImportReference {
    pub line: usize,
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct UnresolvedImport {
    pub file: String,
    pub line: usize,
    pub path: String,
}

pub fn render_dot(graphs: &[DependencyGraph]) -> String {
    let quote = |value: &str| serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_owned());
    let mut output = vec![
        "digraph imports {".to_owned(),
        "  rankdir=LR;".to_owned(),
        "  graph [compound=true];".to_owned(),
        "  node [shape=box, style=rounded];".to_owned(),
    ];
    let colors = [
        "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#c2410c", "#a16207", "#15803d", "#0f766e",
        "#0284c7",
    ];
    for (graph_index, graph) in graphs.iter().enumerate() {
        let indent = if graphs.len() > 1 { "    " } else { "  " };
        if graphs.len() > 1 {
            output.push(format!("  subgraph cluster_graph_{graph_index} {{"));
            let label = graph
                .group
                .as_ref()
                .map(|group| format!("{group} / {}", graph.name))
                .unwrap_or_else(|| graph.name.clone());
            output.push(format!("    label={};", quote(&label)));
        }
        let node_id = |id: &str| {
            if graphs.len() > 1 {
                format!("{}::{id}", graph.id)
            } else {
                id.to_owned()
            }
        };
        let mut domains: Vec<_> = graph
            .nodes
            .iter()
            .filter_map(|node| node.domain.clone())
            .collect();
        domains.sort();
        domains.dedup();
        for (domain_index, domain) in domains.iter().enumerate() {
            let color = colors[domain_index % colors.len()];
            output.push(format!(
                "{indent}subgraph cluster_{graph_index}_{domain_index} {{"
            ));
            output.push(format!(
                "{indent}  label={}; color=\"{color}\";",
                quote(domain)
            ));
            for node in graph
                .nodes
                .iter()
                .filter(|node| node.domain.as_ref() == Some(domain))
            {
                output.push(format!(
                    "{indent}  {} [color=\"{color}\"]",
                    quote(&node_id(&node.id))
                ));
            }
            output.push(format!("{indent}}}"));
        }
        for node in graph.nodes.iter().filter(|node| node.domain.is_none()) {
            output.push(format!(
                "{indent}{} [color=\"#64748b\", fontcolor=\"#64748b\"];",
                quote(&node_id(&node.id))
            ));
        }
        for edge in &graph.edges {
            let style = if edge.kind == EdgeKind::Module {
                "dashed"
            } else {
                "solid"
            };
            output.push(format!(
                "{indent}{} -> {} [style={style}, label={}];",
                quote(&node_id(&edge.source)),
                quote(&node_id(&edge.target)),
                quote(edge.kind.as_str())
            ));
        }
        if graphs.len() > 1 {
            output.push("  }".to_owned());
        }
    }
    output.push("}".to_owned());
    output.join("\n") + "\n"
}
