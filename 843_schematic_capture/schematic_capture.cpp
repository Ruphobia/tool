#include "schematic_capture.hpp"

namespace schematic_capture {

void init()     {}
void shutdown() {}

Status status() {
    Status s;
    s.ready  = false;
    s.detail = "stub: Schematic capture (Electronics and EDA). Awaits wire-up.";
    return s;
}

}
