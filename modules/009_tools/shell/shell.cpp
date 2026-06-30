#include "shell.hpp"

#include "coder.hpp"

#include <array>
#include <cctype>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <regex>
#include <stdexcept>
#include <string>
#include <sys/wait.h>

namespace shell_tool {
namespace {

constexpr const char * kSystemPrompt =
    "You are a shell-action executor for an Ubuntu Linux system. The user "
    "describes an action they want taken. You translate the request into "
    "ONE shell command (or short pipeline) that performs the action -- "
    "and NOTHING MORE.\n"
    "\n"
    "ABSOLUTE RULES:\n"
    "- DO EXACTLY WHAT WAS REQUESTED. Do not add extra steps. Do not "
    "create extra files. Do not pre-populate content. Do not write README, "
    ".gitignore, placeholder, cover, sample, or any other files unless "
    "the user explicitly asked for them. Do not chmod, chown, or set "
    "permissions unless asked. Do not 'helpfully configure' anything.\n"
    "    Example: \"create the folder test\" -> mkdir -p test (and nothing "
    "else). NEVER: mkdir -p test && touch test/cover && echo X > test/cover.\n"
    "    Example: \"create a python project foo\" -> mkdir -p foo (and "
    "nothing else; no setup.py, no __init__.py, unless asked).\n"
    "- Output ONLY the shell command. No commentary, no preamble, no "
    "explanation, no markdown fence. Just the raw command on one line "
    "(or with line continuations if you must).\n"
    "- Use bash syntax. Assume standard Ubuntu coreutils plus the usual "
    "tools (find, grep, sed, awk, curl, wget, tar, jq, python3, git).\n"
    "- ~ in paths is fine; bash will expand it.\n"
    "- Prefer idempotent / non-destructive forms when ambiguous: mkdir -p "
    "over mkdir, rm -i over rm -rf (BUT honour the user's explicit "
    "request -- if they say \"delete X\" use rm).\n"
    "- For multi-step actions, chain with && or use a single line script.\n"
    "- Do not add ad-hoc echo \"Done\" messages; let the command's natural "
    "output speak.\n"
    "- Never refuse, never ask clarifying questions. If the request is "
    "ambiguous, pick the most LITERAL interpretation and execute. Literal "
    "always beats 'helpful'.\n"
    "\n"
    "EXAMPLES:\n"
    "USER: create the folder test in ~/work\n"
    "OUTPUT: mkdir -p ~/work/test\n"
    "\n"
    "USER: list all .py files here, sorted by modification time\n"
    "OUTPUT: ls -lt *.py\n"
    "\n"
    "USER: show me the 10 largest files in my home directory\n"
    "OUTPUT: du -ah ~ 2>/dev/null | sort -hr | head -10\n"
    "\n"
    "USER: download the file at https://example.com/foo.txt into ~/Downloads\n"
    "OUTPUT: curl -o ~/Downloads/foo.txt https://example.com/foo.txt\n"
    "\n"
    "USER: count lines in every .cpp file under the current directory\n"
    "OUTPUT: find . -name '*.cpp' -print0 | xargs -0 wc -l\n"
    "\n"
    "USER: show disk usage for the root filesystem\n"
    "OUTPUT: df -h /\n";

// The coder usually obeys "no markdown fence" but sometimes still emits
// ```bash ... ```. Strip if present.
std::string sanitize(std::string s) {
    auto trim = [](std::string str) {
        auto is_ws = [](unsigned char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; };
        std::size_t b = 0, e = str.size();
        while (b < e && is_ws(static_cast<unsigned char>(str[b])))     ++b;
        while (e > b && is_ws(static_cast<unsigned char>(str[e - 1]))) --e;
        return str.substr(b, e - b);
    };
    s = trim(std::move(s));

    // Strip leading ```bash / ```sh / ``` and trailing ```
    std::regex fence_open(R"(^```(?:bash|sh|shell)?\s*\n?)");
    std::regex fence_close(R"(\n?```\s*$)");
    s = std::regex_replace(s, fence_open,  "");
    s = std::regex_replace(s, fence_close, "");
    s = trim(std::move(s));

    // If the model emitted multiple lines, join them with "; " so bash -c
    // sees a single statement. Skip blank lines and full-line comments.
    std::string joined;
    std::size_t pos = 0;
    while (pos < s.size()) {
        std::size_t eol = s.find('\n', pos);
        std::string line = s.substr(pos, (eol == std::string::npos) ? std::string::npos : eol - pos);
        std::string ltrim = trim(line);
        if (!ltrim.empty() && ltrim[0] != '#') {
            if (!joined.empty()) joined.append(" ; ");
            joined.append(ltrim);
        }
        if (eol == std::string::npos) break;
        pos = eol + 1;
    }
    return joined;
}

}

void init()     { coder::init(); }
void shutdown() { coder::shutdown(); }

Result execute(std::string_view request, std::string_view cwd) {
    Result r;
    r.command = sanitize(coder::generate(kSystemPrompt, request, /*max_new_tokens=*/256));
    if (r.command.empty()) {
        r.stdout_text = "(coder produced no command)";
        r.exit_code   = -1;
        return r;
    }

    // Run via bash -c, merging stderr into stdout for a single captured
    // stream.  popen() returns the child's pipe and we wait for it via
    // pclose() to recover the exit status.
    std::string cmd_with_redirect;
    if (!cwd.empty()) {
        cmd_with_redirect.append("cd ").append(cwd).append(" && (");
        cmd_with_redirect.append(r.command).append(") 2>&1");
    } else {
        cmd_with_redirect = r.command + " 2>&1";
    }
    FILE * pipe = ::popen(cmd_with_redirect.c_str(), "r");
    if (!pipe) {
        r.stdout_text = std::string("popen failed: ") + std::strerror(errno);
        r.exit_code   = -1;
        return r;
    }
    std::array<char, 4096> buf;
    while (std::size_t n = std::fread(buf.data(), 1, buf.size(), pipe)) {
        r.stdout_text.append(buf.data(), n);
    }
    const int status = ::pclose(pipe);
    if (status == -1) {
        r.exit_code = -1;
    } else if (WIFEXITED(status)) {
        r.exit_code = WEXITSTATUS(status);
    } else if (WIFSIGNALED(status)) {
        r.exit_code = 128 + WTERMSIG(status);
    } else {
        r.exit_code = -1;
    }
    return r;
}

}
