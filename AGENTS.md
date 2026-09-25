# Engineering guidelines

This is a greenfield project. Nothing has launched, there are no users, and
nothing is depended on. Move fast, try things, and break them freely.

- Do not preserve backward compatibility.
- Choose the simplest implementation that fully meets the current requirements.
- Prefer established, well-maintained libraries over custom implementations.
- No migrations, deprecation paths, compatibility shims, or feature flags for
  old behavior — delete the old thing and replace it.

# Replies

Write the body of a reply however much the work needs — long, detailed, as much
context as it takes. The reader has ADHD, so that detail is fine, but it must
not be the only way to get the answer.

End every reply with a short block, after a `---` rule, that stands on its own
without the text above it:

- Three to five bullets, one line each, no heading.
- What changed or what it means first, then anything blocked or waiting on a
  decision.
- Plain words. No restating the reasoning, no hedging, no links to chase for
  the basics.
- If there is an action for the reader, it is the last bullet, in bold, starts
  with a verb, and it is one action — not a menu of options.

Skip the block only when the whole reply is already one or two lines.
