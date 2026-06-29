#include "test_runner.hpp"
#include "../849_spice_simulator/spice_simulator.hpp"

namespace {

testing::TestOutcome run_spice_simulator() {
    spice_simulator::init();
    auto s = spice_simulator::status();
    if (s.ready)            return testing::fail("stub claims ready");
    if (s.detail.empty())   return testing::fail("stub detail empty");
    if (s.detail.find("stub") == std::string::npos)
        return testing::fail("stub detail not labeled stub");
    spice_simulator::shutdown();
    return testing::ok();
}

const int _reg_spice_simulator = testing::register_test(
    "spice_simulator",
    "849_spice_simulator: stub status check",
    &run_spice_simulator);

}
