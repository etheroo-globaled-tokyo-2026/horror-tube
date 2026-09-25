import { defineRule } from "@oxlint/plugins";

const DIRECTIVE = /^\s*(\/\s*<reference\s|@ts-(expect-error|ignore|nocheck)\b)/u;
const SAFETY = /^\s*SAFETY\s*:/u;
const WARNING = /^\s*\*?\s*WARNING\b/u;

export const noCommentsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow comments. Code states what; docs state why. Allowed: SAFETY: on assertions, tooling directives, and at most one WARNING comment per file.",
    },
    messages: {
      noComments:
        "No comments. Make the code say it, or move the note to a doc. The only comment a file may carry is a single WARNING (plus SAFETY: on assertions).",
      extraWarning: "One WARNING comment per file, at most.",
    },
  },
  createOnce(context) {
    return {
      Program() {
        let warnings = 0;
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.loc.start.line === 1 && context.sourceCode.text.startsWith("#!")) continue;
          if (DIRECTIVE.test(comment.value) || SAFETY.test(comment.value)) continue;
          if (WARNING.test(comment.value)) {
            warnings += 1;
            if (warnings > 1) {
              context.report({ loc: comment.loc, messageId: "extraWarning" });
            }
            continue;
          }
          context.report({ loc: comment.loc, messageId: "noComments" });
        }
      },
    };
  },
});
