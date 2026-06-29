#include "test_runner.hpp"
#include "../844_pcb_layout/pcb_layout.hpp"

namespace {

testing::TestOutcome run_pcb_layout() {
    pcb_layout::init();
    auto s = pcb_layout::status();
    if (s.ready)            return testing::fail("stub claims ready");
    if (s.detail.empty())   return testing::fail("stub detail empty");
    if (s.detail.find("stub") == std::string::npos)
        return testing::fail("stub detail not labeled stub");
    pcb_layout::shutdown();
    return testing::ok();
}

const int _reg_pcb_layout = testing::register_test(
    "pcb_layout",
    "844_pcb_layout: stub status check",
    &run_pcb_layout);

}
