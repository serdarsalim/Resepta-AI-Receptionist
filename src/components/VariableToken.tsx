"use client";

// A message variable inside the email editor as ONE thing (P15, the Nudge
// port): it reads as a chip carrying the variable's label in the reader's
// language, the caret steps over it, and backspace takes the whole token.
//
// It stores nothing but the key. The label is looked up at DRAW time, which is
// what lets a chip appear correctly the moment the variables load. A key this
// business has no variable for renders as the plain `[key]` it will ship as:
// dressing it as a chip is how a typo hides.

import { useMemo } from "react";
import { Node, mergeAttributes, nodeInputRule } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useMessageVariables } from "./VariableInsertDropdown";
import { buildTokenLabelMap } from "@/lib/tokenLabels";

function Chip({ node }: NodeViewProps) {
  const key = String(node.attrs.key ?? "");
  const variables = useMessageVariables();
  const map = useMemo(() => buildTokenLabelMap(variables), [variables]);
  const resolved = map.resolve(key);
  const label = resolved
    ? (map.display.get(resolved) ?? variables.find((v) => v.key === resolved)?.label)
    : undefined;
  return (
    <NodeViewWrapper as="span" className="inline">
      {label ? (
        <span
          contentEditable={false}
          title={`[${key}]`}
          className="rounded bg-blue-100 px-1 font-medium text-blue-700 dark:bg-blue-500/25 dark:text-blue-300"
        >
          {label}
        </span>
      ) : (
        <span contentEditable={false}>{`[${key}]`}</span>
      )}
    </NodeViewWrapper>
  );
}

export const VariableToken = Node.create({
  name: "variableToken",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      key: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-token") ?? "",
        renderHTML: (attrs) => ({ "data-token": String(attrs.key ?? "") }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-token]" }];
  },

  // The serialized form is exactly what lib/emailTokens turns back into text,
  // and its content is a bare string: keep it that way or htmlToTokens' scan
  // to the first </span> runs past the node.
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), `[${String(node.attrs.key ?? "")}]`];
  },

  // Typing a token by hand closes it into a chip on the "]", so the two ways
  // in (the "@" menu and the keyboard) end in the same place.
  addInputRules() {
    return [
      nodeInputRule({
        find: /\[([A-Za-z0-9_]{1,32})\]$/,
        type: this.type,
        getAttributes: (m) => ({ key: m[1] }),
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(Chip);
  },
});
