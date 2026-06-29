#pragma once

#include <string>

// Stub module for the "Gerber and fab-output viewer" tool entry.
// Electronics and EDA.
// Real implementation deferred; this file commits the namespace API so
// downstream code can wire to it now and the smoke test can hold the
// surface stable.
namespace gerber_and_fab_output_viewer {

struct Status {
    bool        ready = false;
    std::string detail;
};

void init();
void shutdown();
Status status();

}
