#include "server.hpp"
#include "httplib.h"
#include "assets_gen.hpp"
#include "status.hpp"

// pipeline layers
#include "../001_prompt_cleanup/cleanup.hpp"
#include "../002_dictionary/dictionary.hpp"
#include "../003_stylize/stylize.hpp"
#include "../004_expertise/expertise.hpp"
#include "../005_context/context.hpp"
#include "../006_disambiguate/disambiguate.hpp"
#include "../007_knowledge/kb.hpp"
#include "../008_entities/entities.hpp"
#include "../009_tools/classify.hpp"
#include "../009_tools/answer.hpp"
#include "../009_tools/statement.hpp"
#include "../009_tools/shell/shell.hpp"
#include "../009_tools/physics/physics.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <atomic>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <sys/wait.h>
#include <thread>
#include <unordered_set>
#include <vector>

namespace web_server {
namespace fs = std::filesystem;
using json   = nlohmann::json;

namespace {

std::mutex                       g_mtx;
std::unique_ptr<httplib::Server> g_srv;
std::atomic<bool>                g_running{false};

// ---- helpers -----------------------------------------------------------

std::string expand_home(std::string p) {
    if (p.empty()) return p;
    if (p[0] == '~') {
        const char * home = std::getenv("HOME");
        return std::string(home ? home : "/") + p.substr(1);
    }
    return p;
}

const std::unordered_set<std::string> kStopWords = {
    "a","an","the","of","in","on","at","to","for","by","with","from","as",
    "and","or","but","so","if","when","while","because",
    "i","you","he","she","it","we","they","me","him","her","us","them",
    "is","am","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","can","could","shall",
    "should","may","might","must","not","no","yes",
    "this","that","these","those","than",
};

std::vector<std::string> unique_words_in_order(const std::string & text) {
    std::vector<std::string> out;
    std::unordered_set<std::string> seen;
    std::string cur;
    auto flush = [&]{
        if (cur.empty()) return;
        std::string lower;
        lower.reserve(cur.size());
        for (char c : cur) lower.push_back(static_cast<char>(std::tolower((unsigned char)c)));
        if (seen.insert(lower).second) out.push_back(lower);
        cur.clear();
    };
    for (char c : text) {
        if (std::isalpha((unsigned char)c)) cur.push_back(c);
        else flush();
    }
    flush();
    return out;
}

std::string build_stylize_defs(const std::vector<std::string> & words) {
    std::string s;
    bool first = true;
    for (const std::string & w : words) {
        if (kStopWords.count(w)) continue;
        const auto entries = dictionary::lookup(w);
        std::vector<std::string> senses;
        for (const auto & e : entries) {
            if (e.source != "WordNet") continue;
            senses.push_back(e.definition);
            if (senses.size() >= 5) break;
        }
        if (senses.empty()) continue;
        if (!first) s.append(", ");
        first = false;
        s.append(w).append(" (");
        for (std::size_t i = 0; i < senses.size(); ++i) {
            if (i) s.append("; ");
            s.append(senses[i]);
        }
        s.append(")");
    }
    return s;
}

// ---- handlers ----------------------------------------------------------

void handle_status(const httplib::Request &, httplib::Response & res) {
    res.set_content(status::snapshot_json(), "application/json");
}

void handle_fs_list(const httplib::Request & req, httplib::Response & res) {
    std::string path = req.get_param_value("path");
    if (path.empty()) path = std::getenv("HOME") ? std::getenv("HOME") : "/";
    path = expand_home(path);

    fs::path p;
    std::error_code ec;
    p = fs::absolute(path, ec);
    if (ec || !fs::exists(p, ec) || !fs::is_directory(p, ec)) {
        res.status = 404;
        json err{{"error","not a directory"},{"path",path}};
        res.set_content(err.dump(), "application/json");
        return;
    }

    std::vector<fs::directory_entry> entries;
    for (const auto & e : fs::directory_iterator(p, fs::directory_options::skip_permission_denied, ec)) {
        entries.push_back(e);
    }
    std::sort(entries.begin(), entries.end(), [](const auto & a, const auto & b){
        const bool da = a.is_directory(), db = b.is_directory();
        if (da != db) return da;
        return a.path().filename().string() < b.path().filename().string();
    });

    json out;
    out["path"]   = p.string();
    out["parent"] = p.parent_path().string();
    out["entries"] = json::array();
    for (const auto & e : entries) {
        json ee;
        ee["name"]   = e.path().filename().string();
        ee["is_dir"] = e.is_directory();
        out["entries"].push_back(std::move(ee));
    }
    res.set_content(out.dump(), "application/json");
}

void handle_fs_read(const httplib::Request & req, httplib::Response & res) {
    std::string path = expand_home(req.get_param_value("path"));
    std::error_code ec;
    if (!fs::is_regular_file(path, ec)) {
        res.status = 404;
        res.set_content(R"({"error":"not a file"})", "application/json");
        return;
    }
    if (fs::file_size(path) > 5 * 1024 * 1024) {
        res.status = 413;
        res.set_content(R"X({"error":"file too large (>5MB)"})X", "application/json");
        return;
    }
    std::ifstream f(path, std::ios::binary);
    std::stringstream ss; ss << f.rdbuf();
    json out;
    out["path"]    = path;
    out["content"] = ss.str();
    res.set_content(out.dump(), "application/json");
}

void handle_fs_mkdir(const httplib::Request & req, httplib::Response & res) {
    json body = json::parse(req.body, nullptr, false);
    if (!body.is_object() || !body.contains("path")) {
        res.status = 400;
        res.set_content(R"({"error":"missing path"})", "application/json");
        return;
    }
    std::error_code ec;
    fs::create_directories(expand_home(body["path"].get<std::string>()), ec);
    if (ec) {
        res.status = 500;
        json err{{"error", ec.message()}};
        res.set_content(err.dump(), "application/json");
        return;
    }
    res.set_content(R"({"ok":true})", "application/json");
}

void handle_fs_write(const httplib::Request & req, httplib::Response & res) {
    json body = json::parse(req.body, nullptr, false);
    if (!body.is_object() || !body.contains("path") || !body.contains("content")) {
        res.status = 400;
        res.set_content(R"({"error":"missing path or content"})", "application/json");
        return;
    }
    const std::string p = expand_home(body["path"].get<std::string>());
    std::ofstream f(p, std::ios::binary | std::ios::trunc);
    if (!f) {
        res.status = 500;
        res.set_content(R"({"error":"open failed"})", "application/json");
        return;
    }
    const std::string c = body["content"].get<std::string>();
    f.write(c.data(), c.size());
    res.set_content(R"({"ok":true})", "application/json");
}

void handle_fs_delete(const httplib::Request & req, httplib::Response & res) {
    std::string path = expand_home(req.get_param_value("path"));
    std::error_code ec;
    fs::remove_all(path, ec);
    if (ec) {
        res.status = 500;
        json err{{"error", ec.message()}};
        res.set_content(err.dump(), "application/json");
        return;
    }
    res.set_content(R"({"ok":true})", "application/json");
}

// POST /api/terminal/exec  {cwd: "...", command: "..."}
void handle_terminal_exec(const httplib::Request & req, httplib::Response & res) {
    json body = json::parse(req.body, nullptr, false);
    if (!body.is_object() || !body.contains("command")) {
        res.status = 400;
        res.set_content(R"({"error":"missing command"})", "application/json");
        return;
    }
    std::string cmd = body["command"].get<std::string>();
    std::string cwd = expand_home(body.value("cwd", std::string{}));
    if (cwd.empty()) cwd = std::getenv("HOME") ? std::getenv("HOME") : "/";

    // Wrap with cd; merge stderr.
    std::string shell_cmd = "cd " + cwd + " && (" + cmd + ") 2>&1";
    FILE * pipe = ::popen(shell_cmd.c_str(), "r");
    if (!pipe) {
        res.status = 500;
        res.set_content(R"({"error":"popen failed"})", "application/json");
        return;
    }
    std::string out_buf;
    std::array<char, 4096> buf;
    while (std::size_t n = std::fread(buf.data(), 1, buf.size(), pipe)) {
        out_buf.append(buf.data(), n);
    }
    int status_code = ::pclose(pipe);
    int exit_code = -1;
    if (status_code != -1 && WIFEXITED(status_code)) {
        exit_code = WEXITSTATUS(status_code);
    } else if (status_code != -1 && WIFSIGNALED(status_code)) {
        exit_code = 128 + WTERMSIG(status_code);
    }

    json out;
    out["command"]   = cmd;
    out["cwd"]       = cwd;
    out["stdout"]    = out_buf;
    out["exit_code"] = exit_code;
    res.set_content(out.dump(), "application/json");
}

// POST /api/chat {message: "...", cwd: "..."}
// Streams Server-Sent Events as each pipeline layer completes:
//   event: layer   data: {"name":"cleanup","content":"..."}
//   event: layer   data: {"name":"classify","content":"..."}
//   ...
//   event: final   data: {"act":..., "final":..., "handler":..., "expertise":...}
// Client uses fetch() + reader to parse and render incrementally.
void handle_chat(const httplib::Request & req, httplib::Response & res) {
    json body = json::parse(req.body, nullptr, false);
    if (!body.is_object() || !body.contains("message")) {
        res.status = 400;
        res.set_content(R"({"error":"missing message"})", "application/json");
        return;
    }
    const std::string message = body["message"].get<std::string>();
    const std::string cwd     = body.value("cwd", std::string{});

    res.set_chunked_content_provider("text/event-stream",
        [message, cwd](std::size_t /*offset*/, httplib::DataSink & sink) -> bool {
            auto emit = [&](const char * evt, const json & data) {
                std::string s = "event: ";
                s.append(evt);
                s.append("\ndata: ");
                s.append(data.dump());
                s.append("\n\n");
                sink.write(s.data(), s.size());
            };

            try {
                context::next_turn();
                context::append("user", "input", message);

                const std::string cleaned = prompt_cleanup::clean(message);
                context::append("cleanup", "output", cleaned);
                emit("layer", {{"name", "cleanup"}, {"content", cleaned}});

                classify::Result act = classify::analyze(cleaned);
                std::string cls = "act=" + act.act + " subtype=" + act.subtype;
                if (!act.tags.empty()) {
                    cls += " tags=";
                    for (std::size_t i = 0; i < act.tags.size(); ++i) {
                        if (i) cls += ",";
                        cls += act.tags[i];
                    }
                }
                context::append("classify", "act", act.act);
                context::append("classify", "subtype", act.subtype);
                emit("layer", {{"name", "classify"}, {"content", cls}});

                if (act.act == "acknowledgment") {
                    json fin;
                    fin["act"]       = {{"act", act.act}, {"subtype", act.subtype}, {"tags", act.tags}};
                    fin["final"]     = "(noted)";
                    fin["handler"]   = {{"kind", "noted"}};
                    fin["expertise"] = "";
                    emit("final", fin);
                    sink.done();
                    return false;
                }

                std::string ents;
                for (const auto & m : entities::extract(cleaned)) {
                    std::string row = m.original + " => " + m.canonical;
                    if (!m.summary.empty()) row += ": " + m.summary;
                    context::append("entities", "resolved", row, m.original);
                    if (!ents.empty()) ents += "\n";
                    ents += row;
                }
                emit("layer", {{"name", "entities"}, {"content", ents.empty() ? "(none)" : ents}});

                // Visible Wikipedia lookup as its own thinking layer.
                // Combine title-suggestion (good for entity names) AND
                // full-text search (good for conceptual questions). Dedupe
                // by article title.
                {
                    auto sug = kb::suggest(cleaned, 3);
                    auto srh = kb::search (cleaned, 4);
                    std::string wk;
                    if (!sug.available || !srh.available) {
                        wk = "(knowledge offline)";
                    } else {
                        std::unordered_set<std::string> seen;
                        auto add = [&](const std::vector<kb::WikiHit> & hits) {
                            for (const auto & h : hits) {
                                if (!seen.insert(h.title).second) continue;
                                wk.append("- ").append(h.title);
                                if (!h.snippet.empty()) {
                                    wk.append(": ").append(h.snippet);
                                }
                                wk.push_back('\n');
                            }
                        };
                        add(sug.hits);
                        add(srh.hits);
                        if (wk.empty()) wk = "(no matches)";
                    }
                    emit("layer", {{"name", "wikipedia"}, {"content", wk}});
                }

                const auto words = unique_words_in_order(cleaned);
                const std::string defs = build_stylize_defs(words);
                context::append("dictionary", "defs", defs);
                emit("layer", {{"name", "dictionary"}, {"content", defs}});

                const auto interpretations = stylize::precise(cleaned, defs);
                std::string interp_block;
                for (const auto & i : interpretations) {
                    const std::string lab = i.label.empty() ? "default" : i.label;
                    std::string row = "[" + lab + "] " + i.text;
                    context::append("stylize", "interpretation", row, lab);
                    if (!interp_block.empty()) interp_block += "\n";
                    interp_block += row;
                }
                emit("layer", {{"name", "stylize"}, {"content", interp_block}});

                const std::string field = expertise::classify(cleaned);
                context::append("expertise", "label", field);
                emit("layer", {{"name", "expertise"}, {"content", field}});

                disambiguate::Decision decision = disambiguate::decide(cleaned, interpretations, field);
                if (decision.needs_question && !interpretations.empty()) {
                    decision.needs_question = false;
                    decision.chosen_label = interpretations[0].label.empty()
                        ? std::string("default") : interpretations[0].label;
                    decision.reasoning = "auto-commit (chat v1 skips interactive questions)";
                }
                context::append("disambiguate", "commit", decision.chosen_label, decision.reasoning);
                emit("layer", {{"name", "disambiguate"},
                               {"content", "commit: " + decision.chosen_label + " — " + decision.reasoning}});

                const std::string final_text =
                    stylize::render_final(cleaned, decision.chosen_label, defs);
                context::append("stylize", "final", final_text, decision.chosen_label);
                emit("layer", {{"name", "render_final"}, {"content", final_text}});

                json handler;
                if (act.act == "command") {
                    const auto sh = shell_tool::execute(final_text, cwd);
                    context::append("shell", "command", sh.command);
                    context::append("shell", "output",  sh.stdout_text,
                                    "exit=" + std::to_string(sh.exit_code));
                    handler["kind"]      = "shell";
                    handler["command"]   = sh.command;
                    handler["stdout"]    = sh.stdout_text;
                    handler["exit_code"] = sh.exit_code;
                    emit("layer", {{"name", "shell"},
                                   {"content", sh.command + "\n" + sh.stdout_text +
                                               "\n[exit " + std::to_string(sh.exit_code) + "]"}});
                } else if (act.act == "question") {
                    // Route physics questions to the physics-specialist
                    // (Qwen3-14B reasoning) on GPU 1; everything else uses
                    // the general answer handler on GPU 0.
                    std::string field_lc;
                    field_lc.reserve(field.size());
                    for (char c : field) field_lc.push_back(
                        static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
                    const bool is_physics = field_lc.find("physics") != std::string::npos;
                    const std::string a = is_physics
                        ? physics::answer(final_text)
                        : answer::respond(final_text);
                    context::append("answer", "response", a, is_physics ? "physics" : "");
                    handler["kind"]   = is_physics ? "physics_answer" : "answer";
                    handler["answer"] = a;
                    emit("layer", {{"name", is_physics ? "physics" : "answer"}, {"content", a}});
                } else if (act.act == "statement") {
                    bool persistent = false;
                    for (const auto & t : act.tags) if (t == "persistent") persistent = true;
                    const std::string msg = statement::ingest(cleaned, final_text, persistent);
                    handler["kind"]    = "statement";
                    handler["message"] = msg;
                    emit("layer", {{"name", "statement"}, {"content", msg}});
                } else {
                    handler["kind"]    = "none";
                    handler["message"] = "no handler for act=" + act.act;
                }

                json fin;
                fin["act"]       = {{"act", act.act}, {"subtype", act.subtype}, {"tags", act.tags}};
                fin["final"]     = final_text;
                fin["handler"]   = handler;
                fin["expertise"] = field;
                emit("final", fin);
            } catch (const std::exception & ex) {
                emit("error", json{{"error", ex.what()}});
            }
            sink.done();
            return false;
        }
    );
}

}

void stop() {
    std::lock_guard<std::mutex> lk(g_mtx);
    if (g_srv) g_srv->stop();
    g_running.store(false);
}

void run(const std::string & host, int port) {
    {
        std::lock_guard<std::mutex> lk(g_mtx);
        g_srv = std::make_unique<httplib::Server>();
    }
    httplib::Server & srv = *g_srv;
    srv.set_payload_max_length(64 * 1024 * 1024);  // up to 64MB writes
    srv.new_task_queue = []{
        return new httplib::ThreadPool(8);
    };

    // No per-request access log on stderr; errors only (see set_error_handler).

    // -- /api/* JSON endpoints --
    srv.Get ("/api/status",        handle_status);
    srv.Get ("/api/fs/list",       handle_fs_list);
    srv.Get ("/api/fs/read",       handle_fs_read);
    srv.Post("/api/fs/mkdir",      handle_fs_mkdir);
    srv.Post("/api/fs/write",      handle_fs_write);
    srv.Delete("/api/fs/delete",   handle_fs_delete);
    srv.Post("/api/terminal/exec", handle_terminal_exec);
    srv.Post("/api/chat",          handle_chat);
    srv.Post("/api/context/clear", [](const httplib::Request &, httplib::Response & r) {
        context::new_session();
        r.set_content(R"({"ok":true})", "application/json");
    });
    srv.Post("/api/quit", [](const httplib::Request &, httplib::Response & r) {
        r.set_content(R"({"ok":true})", "application/json");
        std::thread([]{ web_server::stop(); }).detach();
    });

    // -- static assets (wildcard, last) --
    srv.Get(R"(/.*)", [](const httplib::Request & req, httplib::Response & res) {
        const auto * a = interface_assets::find(req.path);
        if (!a) {
            res.status = 404;
            res.set_content("not found", "text/plain");
            return;
        }
        res.set_content(reinterpret_cast<const char *>(a->data), a->size, a->mime);
    });

    srv.set_error_handler([](const httplib::Request & req, httplib::Response & res) {
        std::fprintf(stderr, "[http %d] %s %s\n",
                     res.status, req.method.c_str(), req.path.c_str());
        char buf[64];
        std::snprintf(buf, sizeof(buf), "error %d\n", res.status);
        res.set_content(buf, "text/plain");
    });

    g_running.store(true);
    std::fprintf(stderr, "tool: web ui listening on http://%s:%d\n", host.c_str(), port);
    srv.listen(host.c_str(), port);
    g_running.store(false);
    std::fprintf(stderr, "tool: web server stopped\n");
}

}
