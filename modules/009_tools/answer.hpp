#pragma once

#include <string>
#include <string_view>

namespace answer {

void init();

// Answer a question using the 14B model + recent session memory + the
// local Wikipedia KB. Concise plain-text answer; no preface, no markdown.
std::string respond(std::string_view rewrite);

}
