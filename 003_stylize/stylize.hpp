#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace stylize {

struct Interpretation {
    // Short note naming the key sense disambiguation, e.g. "hot=attractive",
    // "bank=financial-institution", or "default" when the input is unambiguous.
    std::string label;
    // The full Spock/Coneheads precision rewrite under this interpretation.
    std::string text;
};

void init();
void shutdown();

// Returns one Interpretation per plausible reading of the input (up to ~4).
// Unambiguous inputs return a single entry with label "default". A future
// context-aware layer is expected to pick one Interpretation downstream.
std::vector<Interpretation> precise(std::string_view cleaned,
                                    std::string_view defs);

// Produces the FINAL single rewrite after disambiguation has resolved the
// chosen sense and the user clarifications. Reads recent memory to bind
// every pronoun / vague referent to its actual entity (using both memory
// and world knowledge). Output is one line, same Spock/Coneheads voice as
// precise(), but with NO "unspecified" placeholder phrasing.
std::string render_final(std::string_view cleaned,
                         std::string_view chosen_label,
                         std::string_view defs);

}
