#pragma once

#include <string>
#include <string_view>

namespace status {

// Record a component's lifecycle. `state` is one of "loading", "ready",
// "error". `detail` is a short human-readable hint.
void note(std::string_view component,
          std::string_view state,
          std::string_view detail = {});

// Set the headline displayed in the UI title bar. `ready` toggles the
// overall ready flag (true = all critical components loaded).
void set_overall(std::string_view headline, bool ready);

// JSON snapshot of current status, served by GET /api/status.
//   {
//     "headline": "...",
//     "ready":    true|false,
//     "components": [
//       {"name":"cleanup", "state":"ready",   "detail":""},
//       {"name":"kb",      "state":"loading", "detail":"downloading 17%"},
//       ...
//     ]
//   }
std::string snapshot_json();

}
