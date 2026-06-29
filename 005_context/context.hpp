#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace context {

struct Record {
    int64_t     id   = 0;     // sqlite rowid; 0 for uninitialised
    int64_t     ts   = 0;     // unix milliseconds at insertion
    int64_t     turn = 0;     // REPL turn number this record belongs to
    std::string layer;        // e.g. "user", "cleanup", "stylize", "expertise"
    std::string kind;         // e.g. "input", "output", "label", "interpretation"
    std::string content;      // searched by full-text index
    std::string meta;         // optional JSON for layer-specific extras
};

// Open (or roll to a fresh) session file. Idempotent.
// If a previous session file exists at the canonical path, it is renamed to
// session_<unix_ms>.sqlite so it stays on disk for later inspection. The new
// session starts at turn 0.
//
// path_dir: directory to hold session files (default: "005_context/sessions").
// Creates the directory if missing.
void init(std::string_view path_dir = {});

// Close any open handle. Safe to call multiple times.
void shutdown();

// Roll to a brand-new session in the same directory. The current session
// file is archived (renamed with a unix-ms suffix) and a fresh one is
// created. Used by REPL "/clear".
void new_session();

// Begin a new REPL turn; returns its turn number. All subsequent append()
// calls without an explicit turn arg use this turn until next_turn() is
// called again.
int64_t next_turn();

// Current turn id (0 until next_turn() is called once).
int64_t current_turn();

// Append a record under the current turn (set by next_turn()).
void append(std::string_view layer,
            std::string_view kind,
            std::string_view content,
            std::string_view meta = {});

// Retrieval ----------------------------------------------------------------

// Most-recent N records, newest first.
std::vector<Record> recent(int n);

// All records belonging to a specific turn (chronological order).
std::vector<Record> by_turn(int64_t turn);

// All records emitted by a specific layer (most-recent first), capped.
std::vector<Record> by_layer(std::string_view layer, int limit = 100);

// FTS5 full-text search over `content`, ordered by BM25 relevance.
// `query` is an FTS5 MATCH expression; pass a plain phrase for simple search.
std::vector<Record> search(std::string_view query, int top_k);

// Total record count in the current session.
int64_t count();

// Absolute filesystem path of the active session file.
std::string current_session_path();

// Compact chronological dump of the last `recent_n` records, with noisy
// layers (dictionary, stylize) filtered out. Suitable for inlining into
// LLM prompts. Returns "(memory is empty)\n" when nothing matches.
std::string render_for_prompt(int recent_n = 40);

}
