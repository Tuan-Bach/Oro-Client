const fs = require('fs');
const path = require('path');

const targetVault = path.join(process.env.USERPROFILE || process.env.HOME, 'OroBrain');
const backupVault = path.join(__dirname, '..', 'my-brain');

console.log('Generating 100 interconnected notes in:', targetVault);

// Define categories and note titles with their target links
const noteDefs = [
  // --- Hubs & Core Systems ---
  {
    folder: 'Notes',
    name: 'AI Architecture',
    tags: ['ai', 'architecture', 'systems'],
    links: ['Vector Search Engine', 'Triad Agent System', 'Cognitive Architecture', 'Attention Mechanism', 'Knowledge Graph Theory', 'Second Brain Systems', 'Local LLM Inference', 'Memory Consolidation'],
    summary: 'Central architectural blueprint for autonomous AI agents and local neural memory retrieval pipelines.'
  },
  {
    folder: 'Notes',
    name: 'Second Brain Systems',
    tags: ['pkm', 'productivity', 'knowledge'],
    links: ['Knowledge Graph Theory', 'Zettelkasten Method', 'Bi-directional Linking', 'Evergreen Notes', 'Spaced Repetition', 'Memory Consolidation'],
    summary: 'Methodology and architecture for digital extended cognition and externalized memory networks.'
  },
  {
    folder: 'Notes',
    name: 'Knowledge Graph Theory',
    tags: ['graphs', 'math', 'knowledge'],
    links: ['Bi-directional Linking', 'Graph Centrality Metrics', 'Semantic Networks', 'Force-Directed Placement', 'Ontology Engineering'],
    summary: 'Mathematical foundations of nodes, directed edges, graph density, clustering coefficients, and semantic networks.'
  },
  {
    folder: 'Notes',
    name: 'Cognitive Architecture',
    tags: ['ai', 'cognitive-science', 'mind'],
    links: ['Working Memory Limits', 'Dual Process Theory', 'Mental Models', 'Memory Consolidation', 'Executive Function'],
    summary: 'Computational models of human cognition including SOAR, ACT-R, and modern agentic memory systems.'
  },
  {
    folder: 'Notes',
    name: 'Zettelkasten Method',
    tags: ['pkm', 'writing', 'notes'],
    links: ['Evergreen Notes', 'Bi-directional Linking', 'Atomic Notes', 'Second Brain Systems'],
    summary: 'Luhmann slip-box technique emphasizing atomic note-taking, unique index keys, and dense associative linking.'
  },
  {
    folder: 'Notes',
    name: 'Bi-directional Linking',
    tags: ['graphs', 'pkm', 'links'],
    links: ['Knowledge Graph Theory', 'Backlink Indexing', 'Zettelkasten Method', 'Evergreen Notes'],
    summary: 'Associative two-way hyperlinks transforming hierarchical filesystems into interconnected idea webs.'
  },
  {
    folder: 'Notes',
    name: 'Evergreen Notes',
    tags: ['pkm', 'writing'],
    links: ['Atomic Notes', 'Zettelkasten Method', 'Second Brain Systems'],
    summary: 'Notes designed to be continuously updated, refined, and compounded over years of creative research.'
  },
  {
    folder: 'Notes',
    name: 'Atomic Notes',
    tags: ['pkm', 'notes'],
    links: ['Evergreen Notes', 'Zettelkasten Method'],
    summary: 'The principle that each note should encapsulate exactly one discrete idea or claim with maximum precision.'
  },
  {
    folder: 'Notes',
    name: 'Mental Models',
    tags: ['thinking', 'decision-making'],
    links: ['First Principles Thinking', 'Inversion Principle', 'Second-Order Thinking', 'Cognitive Biases'],
    summary: 'Curated heuristics and frameworks for clear analysis, rational decision making, and problem solving.'
  },
  {
    folder: 'Notes',
    name: 'First Principles Thinking',
    tags: ['reasoning', 'philosophy'],
    links: ['Mental Models', 'Second-Order Thinking', 'Cartesian Doubt'],
    summary: 'Breaking problems down to fundamental truths and reasoning upward rather than analogizing.'
  },
  {
    folder: 'Notes',
    name: 'Inversion Principle',
    tags: ['thinking', 'math'],
    links: ['Mental Models', 'First Principles Thinking'],
    summary: 'Approaching problems backward: studying failure modes to discover conditions for success.'
  },
  {
    folder: 'Notes',
    name: 'Second-Order Thinking',
    tags: ['systems', 'reasoning'],
    links: ['Mental Models', 'Systems Dynamics', 'Feedback Loops'],
    summary: 'Evaluating outcomes beyond immediate first-order consequences to anticipate feedback loops.'
  },
  {
    folder: 'Notes',
    name: 'Systems Dynamics',
    tags: ['systems', 'engineering'],
    links: ['Feedback Loops', 'Nonlinear Dynamics', 'Second-Order Thinking'],
    summary: 'Study of complex interconnected stocks, flows, delays, and non-linear causal loops.'
  },
  {
    folder: 'Notes',
    name: 'Feedback Loops',
    tags: ['systems', 'cybernetics'],
    links: ['Systems Dynamics', 'Homeostasis', 'Reinforcement Learning'],
    summary: 'Self-regulating balancing loops versus compounding reinforcing feedback loops in natural and software systems.'
  },
  {
    folder: 'Notes',
    name: 'Cognitive Biases',
    tags: ['psychology', 'rationality'],
    links: ['Confirmation Bias', 'Availability Heuristic', 'Mental Models', 'Dual Process Theory'],
    summary: 'Systematic deviations from normative logic in judgment and reasoning caused by cognitive heuristics.'
  },
  {
    folder: 'Notes',
    name: 'Dual Process Theory',
    tags: ['psychology', 'neuroscience'],
    links: ['Cognitive Architecture', 'Cognitive Biases', 'Working Memory Limits'],
    summary: 'Kahneman and Tversky model of fast, heuristic System 1 versus deliberative, logical System 2.'
  },
  {
    folder: 'Notes',
    name: 'Working Memory Limits',
    tags: ['psychology', 'neuroscience'],
    links: ['Cognitive Architecture', 'Cognitive Load Theory', 'Second Brain Systems'],
    summary: 'Millers Law (7 ± 2 chunks) and modern 4-chunk capacity limits in human prefrontal cortex.'
  },
  {
    folder: 'Notes',
    name: 'Cognitive Load Theory',
    tags: ['learning', 'ux'],
    links: ['Working Memory Limits', 'Minimalist UI Design', 'Spaced Repetition'],
    summary: 'Optimizing intrinsic, extraneous, and germane cognitive load during complex tool interaction.'
  },
  {
    folder: 'Notes',
    name: 'Spaced Repetition',
    tags: ['learning', 'memory'],
    links: ['Ebbinghaus Forgetting Curve', 'Memory Consolidation', 'Active Recall'],
    summary: 'SuperMemo and Anki SM-2 algorithmic scheduling to maximize long-term memory retention.'
  },
  {
    folder: 'Notes',
    name: 'Active Recall',
    tags: ['learning', 'cognition'],
    links: ['Spaced Repetition', 'Testing Effect', 'Memory Consolidation'],
    summary: 'Strengthening neural synaptic pathways by actively retrieving facts rather than passive review.'
  },
  {
    folder: 'Notes',
    name: 'Memory Consolidation',
    tags: ['neuroscience', 'biology'],
    links: ['Hippocampus Navigation', 'Synaptic Plasticity', 'Spaced Repetition', 'AI Architecture'],
    summary: 'Biological stabilization of transient working memory traces into durable neocortical storage.'
  },
  {
    folder: 'Notes',
    name: 'Synaptic Plasticity',
    tags: ['neuroscience', 'biology'],
    links: ['Hebbian Learning', 'Memory Consolidation', 'Neural Networks Basics'],
    summary: 'Neurons that fire together wire together: Long-Term Potentiation (LTP) and depression.'
  },
  {
    folder: 'Notes',
    name: 'Hebbian Learning',
    tags: ['neuroscience', 'ai'],
    links: ['Synaptic Plasticity', 'Artificial Neurons', 'Unsupervised Learning'],
    summary: 'Biological learning rule where repeated activation increases synaptic connection strength.'
  },
  {
    folder: 'Notes',
    name: 'Minimalist UI Design',
    tags: ['design', 'ui-ux'],
    links: ['Cognitive Load Theory', 'Dark Mode Ergonomics', 'Visual Hierarchy'],
    summary: 'Stripping visual clutter to elevate raw content, high contrast typography, and responsive micro-interactions.'
  },
  {
    folder: 'Notes',
    name: 'Dark Mode Ergonomics',
    tags: ['design', 'hardware'],
    links: ['Minimalist UI Design', 'OLED Power Optimization', 'Visual Fatigue'],
    summary: 'True pitch-black #0c0d10 surfaces minimizing blue light phototoxicity and pupil dilation stress.'
  },
  {
    folder: 'Notes',
    name: 'Unix Philosophy',
    tags: ['software', 'architecture'],
    links: ['Composable CLI Tools', 'Text Streams and Pipes', 'Small is Beautiful'],
    summary: 'Write programs that do one thing well, work with text streams, and compose together cleanly.'
  },
  {
    folder: 'Notes',
    name: 'Composable CLI Tools',
    tags: ['cli', 'tools'],
    links: ['Unix Philosophy', 'Text Streams and Pipes'],
    summary: 'Command line utilities designed with POSIX flags, stdin/stdout piping, and zero bloat.'
  },
  {
    folder: 'Notes',
    name: 'Text Streams and Pipes',
    tags: ['unix', 'architecture'],
    links: ['Unix Philosophy', 'Composable CLI Tools'],
    summary: 'Universal stream interface allowing disparate binaries to communicate via stdout and stdin.'
  },
  {
    folder: 'Notes',
    name: 'Git Versioning Patterns',
    tags: ['git', 'vcs'],
    links: ['Atomic Commits', 'Trunk Based Development', 'Rebase Workflows'],
    summary: 'Best practices for immutable commit graphs, branch lifecycles, and cryptographic content hashes.'
  },
  {
    folder: 'Notes',
    name: 'Atomic Commits',
    tags: ['git', 'workflow'],
    links: ['Git Versioning Patterns', 'Trunk Based Development'],
    summary: 'Commits encapsulating a single functional change that builds cleanly and passes all test suites.'
  },

  // --- Research: Deep Dive AI & Data ---
  {
    folder: 'Research',
    name: 'Vector Search Engine',
    tags: ['vector', 'search', 'embeddings'],
    links: ['HNSW Indexing', 'Cosine Similarity Math', 'Local ONNX Embeddings', 'Hybrid BM25 and Vector', 'AI Architecture'],
    summary: 'High-dimensional semantic search over note chunks using dense vector embeddings and approximate nearest neighbors.'
  },
  {
    folder: 'Research',
    name: 'HNSW Indexing',
    tags: ['algorithms', 'vector', 'graphs'],
    links: ['Vector Search Engine', 'Cosine Similarity Math', 'Graph Theory Foundations'],
    summary: 'Hierarchical Navigable Small World graphs: logarithmic search complexity for nearest neighbor queries.'
  },
  {
    folder: 'Research',
    name: 'Cosine Similarity Math',
    tags: ['math', 'vector', 'linear-algebra'],
    links: ['Vector Search Engine', 'Dot Product Optimizations', 'HNSW Indexing'],
    summary: 'Measuring angle between normalized vectors in n-dimensional embedding space regardless of magnitude.'
  },
  {
    folder: 'Research',
    name: 'Local ONNX Embeddings',
    tags: ['onnx', 'local-ai', 'performance'],
    links: ['Vector Search Engine', 'Quantization Techniques', 'all-MiniLM-L6-v2 Benchmark'],
    summary: 'Running 384-dimensional embedding models locally using ONNX Runtime with Zero-Network dependency.'
  },
  {
    folder: 'Research',
    name: 'Hybrid BM25 and Vector',
    tags: ['search', 'retrieval', 'rag'],
    links: ['Vector Search Engine', 'SQLite FTS5 Full Text', 'Reciprocal Rank Fusion'],
    summary: 'Combining exact keyword lexical scoring (BM25) with semantic vector embeddings for robust search precision.'
  },
  {
    folder: 'Research',
    name: 'Reciprocal Rank Fusion',
    tags: ['search', 'algorithms'],
    links: ['Hybrid BM25 and Vector', 'Information Retrieval Metrics'],
    summary: 'RRF scoring algorithm to combine ranked lists from multiple heterogeneous retrieval engines.'
  },
  {
    folder: 'Research',
    name: 'SQLite FTS5 Full Text',
    tags: ['database', 'sqlite', 'fts'],
    links: ['Hybrid BM25 and Vector', 'Porter Stemming Algorithm', 'Database Index Tuning'],
    summary: 'In-process full-text search table with BM25 ranking, trigram tokenizers, and prefix queries.'
  },
  {
    folder: 'Research',
    name: 'Attention Mechanism',
    tags: ['transformers', 'ai', 'math'],
    links: ['Transformer Architecture', 'Scaled Dot-Product Attention', 'KV Cache Optimization', 'AI Architecture'],
    summary: 'Dynamic query-key-value weighting enabling neural networks to model arbitrary long-range token relationships.'
  },
  {
    folder: 'Research',
    name: 'Transformer Architecture',
    tags: ['transformers', 'deep-learning'],
    links: ['Attention Mechanism', 'Positional Encoding', 'Feed Forward Layers', 'Flash Attention'],
    summary: 'Vaswani et al. architecture replacing recurrence and convolutions with multi-head self-attention.'
  },
  {
    folder: 'Research',
    name: 'Flash Attention',
    tags: ['gpu', 'cuda', 'performance'],
    links: ['Transformer Architecture', 'Attention Mechanism', 'GPU SRAM Memory Hierarchy'],
    summary: 'Exact attention algorithm optimizing memory IO between high-bandwidth GPU HBM and fast SRAM.'
  },
  {
    folder: 'Research',
    name: 'KV Cache Optimization',
    tags: ['llm', 'inference', 'performance'],
    links: ['Attention Mechanism', 'Paged Attention', 'Transformer Architecture'],
    summary: 'Caching Key and Value tensors during autoregressive generation to avoid quadratic recomputations.'
  },
  {
    folder: 'Research',
    name: 'Paged Attention',
    tags: ['memory', 'operating-systems', 'llm'],
    links: ['KV Cache Optimization', 'Virtual Memory Paging'],
    summary: 'Virtual memory inspired KV cache allocation preventing fragmentation and enabling prompt sharing (vLLM).'
  },
  {
    folder: 'Research',
    name: 'Triad Agent System',
    tags: ['agents', 'architecture', 'orchestration'],
    links: ['Architect Role Definition', 'Builder Execution Engine', 'Critic Verification Loop', 'AI Architecture'],
    summary: 'Three-stage autonomous cognitive pipeline: Architect plans, Builder executes tool calls, Critic verifies invariants.'
  },
  {
    folder: 'Research',
    name: 'Architect Role Definition',
    tags: ['agents', 'planning'],
    links: ['Triad Agent System', 'Task Decomposition Strategies'],
    summary: 'Strategic planning agent that breaks user prompts into executable sub-steps and verification targets.'
  },
  {
    folder: 'Research',
    name: 'Builder Execution Engine',
    tags: ['agents', 'execution', 'tools'],
    links: ['Triad Agent System', 'Tool Use Protocols', 'Tool Call Sandboxing'],
    summary: 'Focused builder agent executing atomic file writes, commands, and refactoring scripts.'
  },
  {
    folder: 'Research',
    name: 'Critic Verification Loop',
    tags: ['agents', 'testing', 'quality'],
    links: ['Triad Agent System', 'Automated Code Verification', 'Self-Healing Loops'],
    summary: 'Independent critic running typechecks, unit tests, and invariant checks before marking tasks done.'
  },
  {
    folder: 'Research',
    name: 'Self-Healing Loops',
    tags: ['agents', 'resilience'],
    links: ['Critic Verification Loop', 'Builder Execution Engine'],
    summary: 'Automated feedback cycles where build/test errors are fed directly back into prompt context for correction.'
  },
  {
    folder: 'Research',
    name: 'Local LLM Inference',
    tags: ['ollama', 'gguf', 'local-ai'],
    links: ['Quantization Techniques', 'GGUF Format Specs', 'Llama 3.2 Benchmarks', 'AI Architecture'],
    summary: 'Running Llama 3.2, Mistral, and DeepSeek locally via Ollama with llama.cpp backend.'
  },
  {
    folder: 'Research',
    name: 'Quantization Techniques',
    tags: ['math', 'compression', 'ai'],
    links: ['Local LLM Inference', 'AWQ vs GPTQ vs GGUF', 'Local ONNX Embeddings'],
    summary: 'Reducing weight precision from FP16 to INT8/INT4 to fit LLMs within consumer VRAM and RAM.'
  },
  {
    folder: 'Research',
    name: 'GGUF Format Specs',
    tags: ['formats', 'binary', 'llm'],
    links: ['Local LLM Inference', 'Quantization Techniques'],
    summary: 'Extensible single-file binary format for quantized neural network weights created by Georgi Gerganov.'
  },
  {
    folder: 'Research',
    name: 'Graph Centrality Metrics',
    tags: ['graph-theory', 'algorithms'],
    links: ['Knowledge Graph Theory', 'PageRank Algorithm', 'Degree Centrality Math'],
    summary: 'Mathematical formulations of degree centrality, betweenness, closeness, and eigenvector centrality.'
  },
  {
    folder: 'Research',
    name: 'PageRank Algorithm',
    tags: ['graphs', 'linear-algebra'],
    links: ['Graph Centrality Metrics', 'Markov Chains', 'Knowledge Graph Theory'],
    summary: 'Stationary probability distribution of a random surfer traversing hyperlinks with damping factor d.'
  },
  {
    folder: 'Research',
    name: 'Force-Directed Placement',
    tags: ['physics', 'visualization', 'simulation'],
    links: ['Verlet Integration Physics', 'Coulombs Repulsion Law', 'Hookes Law Springs', 'Knowledge Graph Theory'],
    summary: 'Simulating mechanical physical forces (spring attraction and charge repulsion) for graph spatialization.'
  },
  {
    folder: 'Research',
    name: 'Verlet Integration Physics',
    tags: ['physics', 'math', 'gamedev'],
    links: ['Force-Directed Placement', 'Hookes Law Springs', 'Viscous Damping Math'],
    summary: 'Time-reversible numerical integration method offering superior numerical stability for particle springs.'
  },
  {
    folder: 'Research',
    name: 'Hookes Law Springs',
    tags: ['physics', 'mechanics'],
    links: ['Force-Directed Placement', 'Verlet Integration Physics'],
    summary: 'Linear restoring force proportional to displacement F = -k * x with non-linear leash extensions.'
  },

  // --- Concepts: Building Blocks & Protocols ---
  {
    folder: 'Concepts',
    name: 'Backlink Indexing',
    tags: ['indexing', 'links', 'database'],
    links: ['Bi-directional Linking', 'SQLite FTS5 Full Text', 'Wiki-Link Regex Engine'],
    summary: 'Inverting target-resolved relationships to power bidirectional graph navigations in milliseconds.'
  },
  {
    folder: 'Concepts',
    name: 'Wiki-Link Regex Engine',
    tags: ['parsing', 'regex'],
    links: ['Backlink Indexing', 'Markdown AST Generation'],
    summary: 'Fast parser extracting target note references and optional aliases like [[Target Note|Display Text]].'
  },
  {
    folder: 'Concepts',
    name: 'Markdown AST Generation',
    tags: ['compilers', 'ast', 'markdown'],
    links: ['Wiki-Link Regex Engine', 'Frontmatter YAML Parsing'],
    summary: 'Tokenizing CommonMark markdown into structured abstract syntax tree nodes for fast inspection.'
  },
  {
    folder: 'Concepts',
    name: 'Frontmatter YAML Parsing',
    tags: ['yaml', 'metadata'],
    links: ['Markdown AST Generation', 'Vault Schema Standards'],
    summary: 'Extracting YAML metadata delimiters (---) for tags, aliases, creation timestamps, and custom attributes.'
  },
  {
    folder: 'Concepts',
    name: 'Viscous Damping Math',
    tags: ['physics', 'simulation'],
    links: ['Verlet Integration Physics', 'Force-Directed Placement'],
    summary: 'Exponential velocity decay modeling fluid friction to eliminate graph oscillation and jiggling.'
  },
  {
    folder: 'Concepts',
    name: 'Degree Centrality Math',
    tags: ['math', 'graphs'],
    links: ['Graph Centrality Metrics', 'Knowledge Graph Theory'],
    summary: 'Raw count of incoming and outgoing links per node, dictating node visual scale and hub importance.'
  },
  {
    folder: 'Concepts',
    name: 'Subtle Ocean Blue Palette',
    tags: ['design', 'colors'],
    links: ['Minimalist UI Design', 'Dark Mode Ergonomics'],
    summary: 'Color token #38bdf8 (Sky-400) calibrated with rgba halos for high-contrast dark themes.'
  },
  {
    folder: 'Concepts',
    name: 'Elastic Anchor Leash',
    tags: ['physics', 'interaction', 'ux'],
    links: ['Hookes Law Springs', 'Verlet Integration Physics', 'Neuron Tree Canvas Design'],
    summary: 'Physics constraint binding nodes to AI-decided fixed coordinates while permitting tactile micro-jiggles.'
  },
  {
    folder: 'Concepts',
    name: 'Neuron Tree Canvas Design',
    tags: ['canvas', 'architecture'],
    links: ['Elastic Anchor Leash', 'Force-Directed Placement', 'High DPR Canvas Rendering'],
    summary: 'Zero-dependency 2D HTML5 Canvas rendering loop delivering 60 FPS under 100+ connected nodes.'
  },
  {
    folder: 'Concepts',
    name: 'High DPR Canvas Rendering',
    tags: ['graphics', 'html5'],
    links: ['NeuronTreeCanvas Design', 'Dark Mode Ergonomics'],
    summary: 'Scaling canvas coordinate buffers by window.devicePixelRatio for crisp Retina fonts and hairlines.'
  },
  {
    folder: 'Concepts',
    name: 'Tool Call Sandboxing',
    tags: ['security', 'agents'],
    links: ['Builder Execution Engine', 'IPC Protocol Specs'],
    summary: 'Strict workspace boundary enforcement preventing file path escape (../) or unauthorized writes.'
  },
  {
    folder: 'Concepts',
    name: 'IPC Protocol Specs',
    tags: ['electron', 'ipc', 'architecture'],
    links: ['Tool Call Sandboxing', 'Electron Architecture Notes'],
    summary: 'Typed asynchronous communication channel between Electron Main and isolated Chromium Renderer.'
  },
  {
    folder: 'Concepts',
    name: 'Electron Architecture Notes',
    tags: ['electron', 'desktop'],
    links: ['IPC Protocol Specs', 'Context Isolation Standards'],
    summary: 'Separation of Node.js capabilities in main process from secure context-isolated UI renderers.'
  },
  {
    folder: 'Concepts',
    name: 'Context Isolation Standards',
    tags: ['security', 'electron'],
    links: ['Electron Architecture Notes', 'Preload Script Hardening'],
    summary: 'Ensuring renderer scripts cannot access node globals directly by bridging strictly typed IPC APIs.'
  },
  {
    folder: 'Concepts',
    name: 'Preload Script Hardening',
    tags: ['security', 'electron'],
    links: ['Context Isolation Standards', 'IPC Protocol Specs'],
    summary: 'Exposing minimal window.oro bridge with frozen objects and explicit argument sanitization.'
  },

  // --- Projects: Active Roadmaps & Specs ---
  {
    folder: 'Projects',
    name: 'Oro Roadmap',
    tags: ['oro', 'roadmap', 'project'],
    links: ['AI Architecture', 'Second Brain Systems', 'Vector Search Engine', 'Triad Agent System', 'Neuron Tree Canvas Design'],
    summary: 'High-level roadmap and milestone deliverables for Oro AI Second Brain desktop workspace.'
  },
  {
    folder: 'Projects',
    name: '2D Knowledge Graph View',
    tags: ['feature', 'ui', 'graph'],
    links: ['Neuron Tree Canvas Design', 'Elastic Anchor Leash', 'Knowledge Graph Theory', 'Subtle Ocean Blue Palette'],
    summary: 'Obsidian-inspired interactive full-screen knowledge graph with fixed AI tree structure and elastic jiggle.'
  },
  {
    folder: 'Projects',
    name: 'Local Vector Search Sprint',
    tags: ['sprint', 'ai', 'vector'],
    links: ['Vector Search Engine', 'Local ONNX Embeddings', 'Hybrid BM25 and Vector'],
    summary: 'Implementation sprint for local semantic similarity search using embedded ONNX models and SQLite.'
  },
  {
    folder: 'Projects',
    name: 'Monaco Editor Integration',
    tags: ['editor', 'ui', 'code'],
    links: ['Minimalist UI Design', 'Markdown AST Generation', 'Dark Mode Ergonomics'],
    summary: 'Full-featured VSCode Monaco code and markdown editor with inline syntax highlighting and vim support.'
  },
  {
    folder: 'Projects',
    name: 'Triad Mode Engine',
    tags: ['agents', 'mode'],
    links: ['Triad Agent System', 'Architect Role Definition', 'Critic Verification Loop'],
    summary: 'Autonomous 3-tier planning and execution cycle for complex multi-file engineering tasks.'
  },
  {
    folder: 'Projects',
    name: 'Brain Space Note List',
    tags: ['ui', 'sidebar', 'pkm'],
    links: ['Second Brain Systems', 'Degree Centrality Math', 'Bi-directional Linking'],
    summary: 'Clean sidebar tab displaying knowledge notes ranked by degree centrality with instant filter.'
  },
  {
    folder: 'Projects',
    name: 'SQLite Store Migration',
    tags: ['database', 'sqlite'],
    links: ['SQLite FTS5 Full Text', 'Backlink Indexing'],
    summary: 'Migrating JSON-based stores to native node:sqlite with write-ahead logging (WAL) and FTS5 tables.'
  },
  {
    folder: 'Projects',
    name: 'Desktop App Bundling',
    tags: ['packaging', 'electron'],
    links: ['Electron Architecture Notes', 'Preload Script Hardening'],
    summary: 'Compiling cross-platform desktop installers, icon packages, and high-performance native binaries.'
  },
  {
    folder: 'Projects',
    name: 'Vault File System Manager',
    tags: ['filesystem', 'vault'],
    links: ['Tool Call Sandboxing', 'Wiki-Link Regex Engine'],
    summary: 'POSIX path-normalized vault manager handling atomic writes, soft trash, and link refactoring on move.'
  },
  {
    folder: 'Projects',
    name: 'Ollama Integration Layer',
    tags: ['ollama', 'local-ai'],
    links: ['Local LLM Inference', 'GGUF Format Specs'],
    summary: 'Native API client for discovering, switching, and streaming completions from local Ollama instances.'
  },
  {
    folder: 'Projects',
    name: 'Gemini 2.5 Provider Client',
    tags: ['gemini', 'api'],
    links: ['AI Architecture', 'Attention Mechanism'],
    summary: 'Streaming SSE client supporting function calling, system instructions, and thoughtSignature preservation.'
  },
  {
    folder: 'Projects',
    name: 'Task Tracking Pipeline',
    tags: ['tasks', 'gtd'],
    links: ['Second Brain Systems', 'Markdown AST Generation'],
    summary: 'Scanning and syncing markdown check-boxes (- [ ] and - [x]) into structured SQLite task tables.'
  },
  {
    folder: 'Projects',
    name: 'Persistent Memory Store',
    tags: ['memory', 'agents'],
    links: ['Memory Consolidation', 'Cognitive Architecture'],
    summary: 'Cross-session agent memory extraction storing facts, preferences, and project guidelines.'
  },
  {
    folder: 'Projects',
    name: 'Cross-Platform Shortcuts',
    tags: ['ux', 'keyboard'],
    links: ['Minimalist UI Design', 'Monaco Editor Integration'],
    summary: 'Unified keyboard hotkey system matching macOS Cmd and Windows/Linux Ctrl conventions.'
  },
  {
    folder: 'Projects',
    name: 'Zen Mode Focus Screen',
    tags: ['ui', 'zen'],
    links: ['Minimalist UI Design', 'Dark Mode Ergonomics'],
    summary: 'Distraction-free full-screen writing canvas with hidden sidebars and floating exit pills.'
  },
  {
    folder: 'Projects',
    name: 'Session History Drawer',
    tags: ['sessions', 'chat'],
    links: ['AI Architecture', 'Persistent Memory Store'],
    summary: 'Chrome-style session tabs and history manager for branching multi-turn agent conversations.'
  },
  {
    folder: 'Projects',
    name: 'Auto-Index File Watcher',
    tags: ['watcher', 'filesystem'],
    links: ['Vault File System Manager', 'Backlink Indexing'],
    summary: 'Recursive fs.watch daemon automatically indexing modified markdown files in milliseconds.'
  },
  {
    folder: 'Projects',
    name: 'Quick Switcher Modal',
    tags: ['navigation', 'search'],
    links: ['SQLite FTS5 Full Text', 'Minimalist UI Design'],
    summary: 'Ctrl+P fuzzy search modal navigating between all files and notes instantly.'
  },
  {
    folder: 'Projects',
    name: 'Link Refactoring Engine',
    tags: ['refactoring', 'vault'],
    links: ['Bi-directional Linking', 'Wiki-Link Regex Engine'],
    summary: 'Automatically updating all [[wiki-links]] across the entire vault when a note file is renamed.'
  },
  {
    folder: 'Projects',
    name: 'Model Quota Monitor',
    tags: ['settings', 'api'],
    links: ['Gemini 2.5 Provider Client', 'AI Architecture'],
    summary: 'Tracking session token consumption and API limits across local and cloud providers.'
  },

  // --- Inbox & Ephemeral Ideas ---
  {
    folder: 'Inbox',
    name: 'Graph Visualization Thoughts',
    tags: ['ideas', 'canvas'],
    links: ['Neuron Tree Canvas Design', 'Elastic Anchor Leash'],
    summary: 'Notes on why spring physics can become unreadable if not constrained by fixed hierarchical anchors.'
  },
  {
    folder: 'Inbox',
    name: 'Vector Database vs Graph Database',
    tags: ['ideas', 'database'],
    links: ['Vector Search Engine', 'Knowledge Graph Theory'],
    summary: 'Comparing vector embeddings for fuzzy conceptual similarity vs knowledge graphs for explicit relationships.'
  },
  {
    folder: 'Inbox',
    name: 'Local First Software Manifesto',
    tags: ['philosophy', 'local-first'],
    links: ['Second Brain Systems', 'Unix Philosophy', 'SQLite FTS5 Full Text'],
    summary: 'Principles of user ownership: data stored in plain text on local disk, zero cloud lock-in.'
  },
  {
    folder: 'Inbox',
    name: 'Book Notes - The Extended Mind',
    tags: ['books', 'psychology'],
    links: ['Second Brain Systems', 'Cognitive Architecture'],
    summary: 'Andy Clark and David Chalmers theory that tools and notebooks physically constitute parts of our cognitive mind.'
  },
  {
    folder: 'Inbox',
    name: 'Book Notes - How to Take Smart Notes',
    tags: ['books', 'writing'],
    links: ['Zettelkasten Method', 'Evergreen Notes', 'Atomic Notes'],
    summary: 'Sönke Ahrens breakdown of the slip-box system for researchers, students, and knowledge workers.'
  },
  {
    folder: 'Inbox',
    name: 'Random Epiphany',
    tags: ['unlinked', 'orphan'],
    links: [], // Intentionally orphan (0 links) to test orphan filtering!
    summary: 'An isolated thought captured on the subway with zero connections to verify orphan detection in the graph.'
  },
  {
    folder: 'Inbox',
    name: 'Scratchpad Note',
    tags: ['temporary', 'orphan'],
    links: [], // Intentionally orphan
    summary: 'Temporary scratch buffer for raw pastes and grocery items.'
  },

  // --- Additional Specialized Notes to hit 100+ Total ---
  {
    folder: 'Notes',
    name: 'Information Architecture',
    tags: ['architecture', 'design'],
    links: ['Second Brain Systems', 'Minimalist UI Design', 'Ontology Engineering'],
    summary: 'Structuring information spaces so users intuitively understand where they are and where to go.'
  },
  {
    folder: 'Notes',
    name: 'Ontology Engineering',
    tags: ['knowledge', 'semantic-web'],
    links: ['Knowledge Graph Theory', 'Information Architecture'],
    summary: 'Formal definitions of entities, properties, and relation hierarchies for semantic interoperability.'
  },
  {
    folder: 'Notes',
    name: 'Semantic Networks',
    tags: ['ai', 'knowledge'],
    links: ['Knowledge Graph Theory', 'Cognitive Architecture'],
    summary: 'Representing propositional knowledge through nodes representing concepts and arcs representing relations.'
  },
  {
    folder: 'Notes',
    name: 'Cartesian Doubt',
    tags: ['philosophy', 'epistemology'],
    links: ['First Principles Thinking', 'Mental Models'],
    summary: 'Method of skepticism: rejecting any belief that carries even a grain of uncertainty to find axioms.'
  },
  {
    folder: 'Notes',
    name: 'Nonlinear Dynamics',
    tags: ['physics', 'systems'],
    links: ['Systems Dynamics', 'Feedback Loops'],
    summary: 'Systems whose outputs are not directly proportional to their inputs, exhibiting bifurcation and chaos.'
  },
  {
    folder: 'Notes',
    name: 'Homeostasis',
    tags: ['biology', 'cybernetics'],
    links: ['Feedback Loops', 'Systems Dynamics'],
    summary: 'Self-regulating biological processes maintaining equilibrium against turbulent external environments.'
  },
  {
    folder: 'Notes',
    name: 'Confirmation Bias',
    tags: ['psychology', 'bias'],
    links: ['Cognitive Biases', 'Mental Models'],
    summary: 'The human tendency to search for, interpret, favor, and recall information confirming prior beliefs.'
  },
  {
    folder: 'Notes',
    name: 'Availability Heuristic',
    tags: ['psychology', 'bias'],
    links: ['Cognitive Biases', 'Dual Process Theory'],
    summary: 'Overestimating the likelihood of events that are easily recalled from emotional or recent memory.'
  },
  {
    folder: 'Notes',
    name: 'Ebbinghaus Forgetting Curve',
    tags: ['memory', 'learning'],
    links: ['Spaced Repetition', 'Memory Consolidation'],
    summary: 'Mathematical formula describing the exponential decay of retained information over time without rehearsal.'
  },
  {
    folder: 'Notes',
    name: 'Testing Effect',
    tags: ['learning', 'cognition'],
    links: ['Active Recall', 'Spaced Repetition'],
    summary: 'Empirical finding that being tested on material produces superior retention compared to restudying.'
  },
  {
    folder: 'Notes',
    name: 'Hippocampus Navigation',
    tags: ['neuroscience', 'biology'],
    links: ['Memory Consolidation', 'Spatial Memory Grid Cells'],
    summary: 'Role of the mammalian hippocampus in spatial mapping, cognitive graphs, and episodic memory binding.'
  },
  {
    folder: 'Notes',
    name: 'Spatial Memory Grid Cells',
    tags: ['neuroscience', 'grid-cells'],
    links: ['Hippocampus Navigation', 'Knowledge Graph Theory'],
    summary: 'Moser Nobel Prize discovery of hexagonal grid firing fields in entorhinal cortex enabling spatial mapping.'
  },
  {
    folder: 'Notes',
    name: 'Visual Hierarchy',
    tags: ['design', 'ui'],
    links: ['Minimalist UI Design', 'Cognitive Load Theory'],
    summary: 'Arranging UI elements in an intentional order of importance using scale, contrast, spacing, and weight.'
  },
  {
    folder: 'Notes',
    name: 'OLED Power Optimization',
    tags: ['hardware', 'battery'],
    links: ['Dark Mode Ergonomics', 'Minimalist UI Design'],
    summary: 'Power draw advantages of true black pixels on emissive displays turning off individual sub-pixels.'
  },
  {
    folder: 'Notes',
    name: 'Visual Fatigue',
    tags: ['ergonomics', 'health'],
    links: ['Dark Mode Ergonomics', 'Minimalist UI Design'],
    summary: 'Preventing asthenopia through balanced contrast ratios and anti-aliased typographic rendering.'
  },
  {
    folder: 'Notes',
    name: 'Small is Beautiful',
    tags: ['philosophy', 'design'],
    links: ['Unix Philosophy', 'Composable CLI Tools'],
    summary: 'Schumacher economics applied to software engineering: avoiding monolithic bloat through modularity.'
  },
  {
    folder: 'Notes',
    name: 'Trunk Based Development',
    tags: ['git', 'engineering'],
    links: ['Git Versioning Patterns', 'Atomic Commits'],
    summary: 'Software development practice where engineers merge short-lived branches to trunk multiple times a day.'
  },
  {
    folder: 'Notes',
    name: 'Rebase Workflows',
    tags: ['git', 'workflow'],
    links: ['Git Versioning Patterns', 'Atomic Commits'],
    summary: 'Maintaining a clean linear commit history without distracting recursive merge commit bubbles.'
  },
  {
    folder: 'Research',
    name: 'Dot Product Optimizations',
    tags: ['math', 'simd'],
    links: ['Cosine Similarity Math', 'Local ONNX Embeddings'],
    summary: 'Using AVX2 and NEON SIMD instructions to accelerate high-dimensional vector dot product computations.'
  },
  {
    folder: 'Research',
    name: 'Graph Theory Foundations',
    tags: ['math', 'graphs'],
    links: ['Knowledge Graph Theory', 'HNSW Indexing', 'Graph Centrality Metrics'],
    summary: 'Eulerian paths, adjacency matrices, spectral graph theory, and topological invariants.'
  },
  {
    folder: 'Research',
    name: 'all-MiniLM-L6-v2 Benchmark',
    tags: ['onnx', 'benchmarks'],
    links: ['Local ONNX Embeddings', 'Vector Search Engine'],
    summary: 'Evaluating 22M parameter sentence transformer yielding 384d embeddings in under 15ms per chunk.'
  },
  {
    folder: 'Research',
    name: 'Information Retrieval Metrics',
    tags: ['ir', 'metrics'],
    links: ['Reciprocal Rank Fusion', 'Hybrid BM25 and Vector'],
    summary: 'Evaluating search engines using Mean Reciprocal Rank (MRR), NDCG@10, and Precision@K.'
  },
  {
    folder: 'Research',
    name: 'Porter Stemming Algorithm',
    tags: ['nlp', 'search'],
    links: ['SQLite FTS5 Full Text', 'Information Retrieval Metrics'],
    summary: 'Heuristic linguistic process for reducing inflected or derived words to their root word stem.'
  },
  {
    folder: 'Research',
    name: 'Database Index Tuning',
    tags: ['database', 'sqlite', 'performance'],
    links: ['SQLite FTS5 Full Text', 'Backlink Indexing'],
    summary: 'B-tree index optimization, covering indexes, and query execution plans via EXPLAIN QUERY PLAN.'
  },
  {
    folder: 'Research',
    name: 'Positional Encoding',
    tags: ['transformers', 'math'],
    links: ['Transformer Architecture', 'Attention Mechanism'],
    summary: 'Injecting sequence order into permutation-invariant self-attention via sinusoidal or RoPE embeddings.'
  },
  {
    folder: 'Research',
    name: 'Feed Forward Layers',
    tags: ['deep-learning', 'transformers'],
    links: ['Transformer Architecture', 'Attention Mechanism'],
    summary: 'Two-layer MLP with SwiGLU activation acting as key-value associative factual memory in LLMs.'
  },
  {
    folder: 'Research',
    name: 'GPU SRAM Memory Hierarchy',
    tags: ['gpu', 'hardware'],
    links: ['Flash Attention', 'Transformer Architecture'],
    summary: 'Analyzing latency disparities between 20TB/s on-chip registers/SRAM and 2TB/s off-chip HBM.'
  },
  {
    folder: 'Research',
    name: 'Virtual Memory Paging',
    tags: ['os', 'memory'],
    links: ['Paged Attention', 'KV Cache Optimization'],
    summary: 'Translating non-contiguous physical memory frames into contiguous virtual address spaces.'
  },
  {
    folder: 'Research',
    name: 'Task Decomposition Strategies',
    tags: ['planning', 'agents'],
    links: ['Architect Role Definition', 'Triad Agent System'],
    summary: 'Techniques for splitting open-ended user objectives into directed acyclic dependency graphs.'
  },
  {
    folder: 'Research',
    name: 'Tool Use Protocols',
    tags: ['agents', 'protocols'],
    links: ['Builder Execution Engine', 'Tool Call Sandboxing'],
    summary: 'Structured JSON schema specifications defining function names, parameter validation, and error contracts.'
  },
  {
    folder: 'Research',
    name: 'Automated Code Verification',
    tags: ['testing', 'quality'],
    links: ['Critic Verification Loop', 'Self-Healing Loops'],
    summary: 'Running linters, AST diagnostics, and subprocess test runners to establish formal correctness.'
  },
  {
    folder: 'Research',
    name: 'Llama 3.2 Benchmarks',
    tags: ['benchmarks', 'llm'],
    links: ['Local LLM Inference', 'GGUF Format Specs'],
    summary: 'Tokens-per-second performance metrics for Meta Llama 3.2 1B and 3B models across CPU and GPU.'
  },
  {
    folder: 'Research',
    name: 'AWQ vs GPTQ vs GGUF',
    tags: ['quantization', 'benchmarks'],
    links: ['Quantization Techniques', 'Local LLM Inference'],
    summary: 'Comparison of Activation-aware Weight Quantization versus post-training quantization formats.'
  },
  {
    folder: 'Research',
    name: 'Markov Chains',
    tags: ['math', 'probability'],
    links: ['PageRank Algorithm', 'Graph Centrality Metrics'],
    summary: 'Stochastic memoryless models describing transitions from one state to another across a state space.'
  },
  {
    folder: 'Research',
    name: 'Coulombs Repulsion Law',
    tags: ['physics', 'simulation'],
    links: ['Force-Directed Placement', 'Verlet Integration Physics'],
    summary: 'Inverse-square electrostatic force F = k * (q1 * q2) / r^2 preventing node collisions in graph layout.'
  },
  {
    folder: 'Concepts',
    name: 'Vault Schema Standards',
    tags: ['standards', 'schema'],
    links: ['Frontmatter YAML Parsing', 'Second Brain Systems'],
    summary: 'Open specification for local second brain notes ensuring long-term software independence.'
  },
  {
    folder: 'Concepts',
    name: 'Artificial Neurons',
    tags: ['neural-networks', 'ai'],
    links: ['Hebbian Learning', 'Neural Networks Basics'],
    summary: 'Perceptrons computing weighted sum of inputs passed through non-linear activation functions.'
  },
  {
    folder: 'Concepts',
    name: 'Unsupervised Learning',
    tags: ['machine-learning', 'clustering'],
    links: ['Hebbian Learning', 'Semantic Networks'],
    summary: 'Discovering hidden patterns and clusters in unlabeled data without explicit target loss feedback.'
  },
  {
    folder: 'Concepts',
    name: 'Neural Networks Basics',
    tags: ['ai', 'foundations'],
    links: ['Artificial Neurons', 'Synaptic Plasticity', 'AI Architecture'],
    summary: 'Foundational concepts of forward propagation, loss functions, backpropagation, and gradient descent.'
  }
];

console.log(`Prepared ${noteDefs.length} distinct note blueprints.`);

// Helper to write note to vault
function writeNoteToVault(vaultDir, def) {
  const folderDir = path.join(vaultDir, def.folder);
  if (!fs.existsSync(folderDir)) {
    fs.mkdirSync(folderDir, { recursive: true });
  }

  const filePath = path.join(folderDir, `${def.name}.md`);
  
  // Format links as markdown [[wiki-links]]
  const linksSection = def.links.length > 0
    ? `## Related Notes & Connections\n\n${def.links.map(l => `- [[${l}]]`).join('\n')}\n\n`
    : `*No outward connections (Orphan leaf note).* \n\n`;

  const content = `---
title: "${def.name}"
date: 2026-11-20
folder: "${def.folder}"
tags: [${def.tags.map(t => `"${t}"`).join(', ')}]
---

# ${def.name}

> [!NOTE] Knowledge Summary
> ${def.summary}

## Overview

${def.summary} This note forms an integral node in the **Oro AI Second Brain** constellation, connecting conceptual theory with practical implementation.

${linksSection}## Deep Dive

In modern second brain systems, notes function like biological synapses: isolated concepts yield minimal insight until linked into associative network structures. 

\`\`\`typescript
// Concept linkage verification
export interface KnowledgeNode {
  title: "${def.name}";
  folder: "${def.folder}";
  connections: ${def.links.length};
}
\`\`\`

- **Category**: \`${def.folder}\`
- **Link Degree**: \`${def.links.length}\`
- **Updated**: \`2026-11-20\`
`;

  fs.writeFileSync(filePath, content, 'utf-8');
}

// Generate in live vault
let createdCount = 0;
for (const def of noteDefs) {
  writeNoteToVault(targetVault, def);
  writeNoteToVault(backupVault, def);
  createdCount++;
}

console.log(`Successfully wrote ${createdCount} notes to:`);
console.log(`1. ${targetVault}`);
console.log(`2. ${backupVault}`);
