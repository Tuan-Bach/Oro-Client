use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String, // posix rel path
    pub title: String,
    pub pagerank: f64,
    pub link_count: usize,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

pub struct PageRank;

impl PageRank {
    /// Computes PageRank scores using the standard power iteration algorithm with dangling node redistribution.
    /// Damping factor d = 0.85, max_iterations = 20, tolerance = 1e-4.
    pub fn compute(
        node_ids: &[String],
        edges: &[(String, String)],
    ) -> HashMap<String, f64> {
        let n = node_ids.len();
        if n == 0 {
            return HashMap::new();
        }

        let d = 0.85;
        let init_rank = 1.0 / (n as f64);
        let mut ranks: HashMap<String, f64> = node_ids.iter().map(|id| (id.clone(), init_rank)).collect();

        // Build adjacency lists
        let mut out_neighbors: HashMap<&str, Vec<&str>> = HashMap::new();
        let mut in_neighbors: HashMap<&str, Vec<&str>> = HashMap::new();

        for id in node_ids {
            out_neighbors.entry(id.as_str()).or_default();
            in_neighbors.entry(id.as_str()).or_default();
        }

        let valid_nodes: HashSet<&str> = node_ids.iter().map(|s| s.as_str()).collect();

        for (src, tgt) in edges {
            if valid_nodes.contains(src.as_str()) && valid_nodes.contains(tgt.as_str()) {
                out_neighbors.entry(src.as_str()).or_default().push(tgt.as_str());
                in_neighbors.entry(tgt.as_str()).or_default().push(src.as_str());
            }
        }

        let max_iterations = 20;
        let tolerance = 1e-4;

        for _ in 0..max_iterations {
            // Calculate total rank of dangling nodes (out-degree == 0)
            let mut dangling_sum = 0.0;
            for id in node_ids {
                let out_deg = out_neighbors.get(id.as_str()).map(|v| v.len()).unwrap_or(0);
                if out_deg == 0 {
                    dangling_sum += ranks.get(id).copied().unwrap_or(0.0);
                }
            }

            let mut next_ranks = HashMap::new();
            let mut diff = 0.0;

            for id in node_ids {
                let id_str = id.as_str();
                let mut incoming_sum = 0.0;

                if let Some(ins) = in_neighbors.get(id_str) {
                    for &in_id in ins {
                        let in_rank = ranks.get(in_id).copied().unwrap_or(0.0);
                        let out_deg = out_neighbors.get(in_id).map(|v| v.len()).unwrap_or(1);
                        if out_deg > 0 {
                            incoming_sum += in_rank / (out_deg as f64);
                        }
                    }
                }

                let new_rank = ((1.0 - d) / (n as f64)) + d * ((dangling_sum / (n as f64)) + incoming_sum);
                diff += (new_rank - ranks.get(id).copied().unwrap_or(0.0)).abs();
                next_ranks.insert(id.clone(), new_rank);
            }

            ranks = next_ranks;

            if diff < tolerance {
                break;
            }
        }

        ranks
    }
}
