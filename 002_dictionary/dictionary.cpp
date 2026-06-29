#include "dictionary.hpp"

#include <nlohmann/json.hpp>

#include <cctype>
#include <fstream>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace dictionary {
namespace {

constexpr const char * kWebsterPath = "resources/dictionary/dictionary.json";
constexpr const char * kWordNetPath = "resources/dictionary/wordnet.json";

struct WordNetSense {
    std::string pos;
    std::string def;
};

std::once_flag                                                g_once;
std::unordered_map<std::string, std::string>                  g_webster;
std::unordered_map<std::string, std::vector<WordNetSense>>    g_wordnet;

std::string to_lower(std::string_view s) {
    std::string r;
    r.reserve(s.size());
    for (char c : s) {
        r.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    return r;
}

nlohmann::json load_json(const char * path) {
    std::ifstream f(path);
    if (!f) {
        throw std::runtime_error(std::string("dictionary: cannot open ") + path);
    }
    nlohmann::json j;
    f >> j;
    return j;
}

void load_webster() {
    auto j = load_json(kWebsterPath);
    if (!j.is_object()) {
        throw std::runtime_error("dictionary: Webster JSON must be an object");
    }
    g_webster.reserve(j.size());
    for (auto it = j.begin(); it != j.end(); ++it) {
        if (it.value().is_string()) {
            g_webster.emplace(to_lower(it.key()), it.value().get<std::string>());
        }
    }
}

void load_wordnet() {
    auto j = load_json(kWordNetPath);
    if (!j.is_object()) {
        throw std::runtime_error("dictionary: WordNet JSON must be an object");
    }
    g_wordnet.reserve(j.size());
    for (auto it = j.begin(); it != j.end(); ++it) {
        if (!it.value().is_array()) continue;
        std::vector<WordNetSense> senses;
        senses.reserve(it.value().size());
        for (const auto & s : it.value()) {
            if (!s.is_object()) continue;
            WordNetSense ws;
            if (s.contains("pos") && s["pos"].is_string()) ws.pos = s["pos"].get<std::string>();
            if (s.contains("def") && s["def"].is_string()) ws.def = s["def"].get<std::string>();
            if (!ws.def.empty()) senses.push_back(std::move(ws));
        }
        if (!senses.empty()) {
            g_wordnet.emplace(to_lower(it.key()), std::move(senses));
        }
    }
}

void load_once() {
    std::call_once(g_once, []{
        load_webster();
        load_wordnet();
    });
}

}

void init() {
    load_once();
}

std::vector<Entry> lookup(std::string_view word) {
    load_once();
    std::vector<Entry> out;
    const std::string key = to_lower(word);

    if (auto it = g_webster.find(key); it != g_webster.end()) {
        out.push_back({"Webster 1913", "", it->second});
    }
    if (auto it = g_wordnet.find(key); it != g_wordnet.end()) {
        for (const auto & s : it->second) {
            out.push_back({"WordNet", s.pos, s.def});
        }
    }
    return out;
}

}
