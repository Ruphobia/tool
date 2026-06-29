#include "test_runner.hpp"
#include "../843_schematic_capture/schematic_capture.hpp"

namespace {

testing::TestOutcome run_schematic_capture() {
    schematic_capture::init();
    auto s = schematic_capture::status();
    if (s.ready)            return testing::fail("stub claims ready");
    if (s.detail.empty())   return testing::fail("stub detail empty");
    if (s.detail.find("stub") == std::string::npos)
        return testing::fail("stub detail not labeled stub");
    schematic_capture::shutdown();
    return testing::ok();
}

const int _reg_schematic_capture = testing::register_test(
    "schematic_capture",
    "843_schematic_capture: stub status check",
    &run_schematic_capture);

}
