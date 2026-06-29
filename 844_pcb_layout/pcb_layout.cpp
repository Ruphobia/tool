#include "pcb_layout.hpp"

namespace pcb_layout {

void init()     {}
void shutdown() {}

Status status() {
    Status s;
    s.ready  = false;
    s.detail = "stub: PCB layout (Electronics and EDA). Awaits wire-up.";
    return s;
}

}
