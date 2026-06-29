#pragma once

#include <string>
#include <string_view>

namespace shell_tool {

struct Result {
    std::string command;        // the shell command the coder produced
    std::string stdout_text;    // captured stdout+stderr from execution
    int         exit_code = -1;
};

// Idempotent. Loads the coder model on GPU 1 (Qwen2.5-Coder-14B). REQUIRES
// prompt_cleanup::init() to have been called first (for the ggml backend).
void init();
void shutdown();

// Translate `request` into a shell command via the coder model, execute it
// with bash -c in `cwd` (when non-empty; otherwise the server's cwd), and
// return both the command and its combined stdout/stderr plus exit code.
// Throws std::runtime_error on coder failure; shell execution failures are
// reported via exit_code, not exceptions.
Result execute(std::string_view request, std::string_view cwd = {});

}
