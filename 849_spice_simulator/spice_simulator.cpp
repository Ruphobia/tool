#include "spice_simulator.hpp"

namespace spice_simulator {

void init()     {}
void shutdown() {}

Status status() {
    Status s;
    s.ready  = false;
    s.detail = "stub: SPICE simulator (Electronics and EDA). Awaits wire-up.";
    return s;
}

}
