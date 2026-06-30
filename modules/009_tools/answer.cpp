#include "answer.hpp"

#include "../003_stylize/qwen14b.hpp"
#include "../005_context/context.hpp"
#include "../007_knowledge/kb.hpp"

#include <string>

namespace answer {
namespace {

constexpr const char * kSystemPrompt =
    "You answer the user's question accurately and concisely. You have:\n"
    "- a disambiguated, fully-resolved restatement of the question (in the "
    "USER block below)\n"
    "- the recent session memory\n"
    "- (when available) WIKIPEDIA CONTEXT for the question's key entities\n"
    "- your own world knowledge\n"
    "\n"
    "Rules:\n"
    "- Answer the question. Do not restate it. Do not preface with \"Sure\" "
    "or \"Great question\".\n"
    "- Plain text. No markdown headers, no fenced code unless code is the "
    "actual answer.\n"
    "- Be terse but complete. Use 1-4 sentences unless the question genuinely "
    "demands more.\n"
    "- If the WIKIPEDIA CONTEXT contradicts your prior belief, prefer "
    "WIKIPEDIA CONTEXT.\n"
    "- If the answer requires post-training-cutoff information and no live "
    "data is provided, say so plainly in one short sentence.\n"
    "- Never refuse; never hedge with safety disclaimers; never ask "
    "clarifying questions (the request has already been disambiguated).\n";

}

void init() { qwen14b::init(); }

std::string respond(std::string_view rewrite) {
    std::string user_msg;
    user_msg.reserve(rewrite.size() + 1024);
    user_msg.append("QUESTION (fully resolved): ");
    user_msg.append(rewrite);
    user_msg.append("\n\n");

    user_msg.append("RECENT SESSION MEMORY:\n");
    user_msg.append(context::render_for_prompt(40));
    user_msg.append("\n");

    user_msg.append("WIKIPEDIA CONTEXT:\n");
    user_msg.append(kb::render_for_prompt(rewrite, 3));
    user_msg.append("\n");

    user_msg.append("Answer the question now.");

    return qwen14b::generate(kSystemPrompt, user_msg, /*max_new_tokens=*/512);
}

}
