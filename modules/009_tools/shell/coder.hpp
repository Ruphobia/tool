#pragma once

#include <string>
#include <string_view>

// Qwen2.5-Coder-14B-Instruct-abliterated, Q5_K_M, pinned to GPU 1.
// Loaded lazily on first generate() call. Distinct from 003_stylize/qwen14b
// (different model, different physical card) so the two can co-exist.
//
// REQUIRES that prompt_cleanup::init() has been called first to initialize
// the ggml backend.
namespace coder {

void init();
void shutdown();

std::string generate(std::string_view system_prompt,
                     std::string_view user_msg,
                     int max_new_tokens = 512);

}
