#include "gerber_and_fab_output_viewer.hpp"

namespace gerber_and_fab_output_viewer {

void init()     {}
void shutdown() {}

Status status() {
    Status s;
    s.ready  = false;
    s.detail = "stub: Gerber and fab-output viewer (Electronics and EDA). Awaits wire-up.";
    return s;
}

}
