"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import { EmojiPicker } from "./EmojiPicker";
import { useMessageVariables, VariableInsertDropdown } from "./VariableInsertDropdown";
import { VariableToken } from "./VariableToken";
import { atFragment, matchTokenVariables, TokenSuggestMenu } from "./TokenSuggestMenu";
import { htmlToTokens, tokensToHtml } from "@/lib/emailTokens";
import { AT_MENU_W } from "@/lib/caretPosition";
import type { TokenVariable } from "@/lib/tokenLabels";
import { SegmentedControl } from "./SegmentedControl";
import { useLanguage } from "@/lib/LanguageProvider";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";
import { HoverTip } from "./HoverTip";
import { InputDialog } from "./InputDialog";

// WYSIWYG email-body editor with an HTML toggle, ported from Nudge and
// trimmed to what a rule's email needs: no media library, no saved-signature
// menu (paste a signature into the HTML view — that is what the view is for).
// Visual mode IS the rendered email (inline styles preserved); the HTML view
// is the escape hatch for hand-edits like signature tables.
//
// Round-trip safety: emails carry inline styles everywhere (signature
// tables, branded links). tiptap normally strips attributes its schema
// doesn't know, so PreserveEmailAttrs registers `style` globally plus the
// table/img presentational attributes, letting pasted HTML survive a visual
// edit mostly intact.

const PreserveEmailAttrs = Extension.create({
  name: "preserveEmailAttrs",
  addGlobalAttributes() {
    const passthrough = (attr: string) => ({
      default: null as string | null,
      parseHTML: (element: HTMLElement) => element.getAttribute(attr),
      renderHTML: (attributes: Record<string, string | null>) =>
        attributes[attr] ? { [attr]: attributes[attr]! } : {},
    });
    return [
      {
        types: [
          "paragraph",
          "heading",
          "bulletList",
          "orderedList",
          "listItem",
          "table",
          "tableRow",
          "tableCell",
          "tableHeader",
          "image",
          "link",
        ],
        attributes: { style: passthrough("style") },
      },
      {
        types: ["table"],
        attributes: {
          cellpadding: passthrough("cellpadding"),
          cellspacing: passthrough("cellspacing"),
          border: passthrough("border"),
        },
      },
      {
        types: ["image"],
        attributes: {
          height: passthrough("height"),
          width: passthrough("width"),
        },
      },
    ];
  },
});

function ToolbarButton({
  title,
  active,
  onClick,
  children,
  // Only the colour button passes one: useAnchoredPanel measures the trigger's
  // rect at open time, so the panel needs a handle on this element.
  ref,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  // The label is a HoverTip: instant, the app's one tooltip look, and through
  // a portal, where the old absolute span clipped on the card it sat in (P20).
  return (
    <HoverTip text={title}>
    <button
      ref={ref}
      type="button"
      aria-label={title}
      // preventDefault on mousedown keeps the editor selection/focus so the
      // command applies to what the user highlighted.
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      // h-7, the control scale's xs (Control.tsx): the same 28px as the
      // variable and emoji pickers at the end of this strip, which were the
      // strip's odd ones out at 22px with a border. Nudge's EditorToolbar is
      // h-7 too. The hover is the foreground wash, which shows in dark.
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs ${
        active
          ? "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]"
          : "text-[var(--muted)] hover:bg-[var(--control-hover)] hover:text-[var(--foreground)]"
      }`}
    >
      {children}
    </button>
    </HoverTip>
  );
}

const PALETTE = ["#000000", "#444444", "#2E7D32", "#dc2626", "#2563eb", "#ca8a04"];

// 14px stroke icon shell for toolbar buttons.
function Ic({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24" width="14" height="14" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden className="mx-auto"
    >
      {children}
    </svg>
  );
}

function Toolbar({
  editor,
  showVariables = true,
  divider = true,
  onChange,
  end,
}: {
  editor: Editor;
  // The row's far right: the Visual / HTML switch, so the framed editor has
  // ONE header row instead of a bar holding only the switch above the tools
  // (P26, Nudge ec043a82).
  end?: React.ReactNode;
  // Saves now. A change made through a dialog or a menu lands while the
  // editor has no focus, so the blur that normally saves never comes.
  onChange: () => void;
  // Tokens are for a TEMPLATE, which is written once and rendered per
  // customer. A one-off reply is already addressed to somebody — nothing
  // renders it on the way out, so a {{name}} inserted here would reach the
  // customer as those eight characters.
  showVariables?: boolean;
  // The rule under the buttons. It earns its place in the framed editor, where
  // the toolbar is a band inside a box and something has to say where the band
  // ends. In the composer there is no box and no band — the buttons sit on the
  // same sheet as the text they format, and a line across it is decoration.
  // Borders belong to containers (AGENTS.md).
  divider?: boolean;
}) {
  const { t } = useLanguage();
  const {
    triggerRef: paletteTrigger,
    panelRef: palettePanel,
    pos: palettePos,
    open: paletteOpen,
    toggle: togglePalette,
    close: closePalette,
  } = useAnchoredPanel(200, 40);
  // The app's own dialog, never window.prompt: a grey browser box titled
  // "localhost says" (P26, Nudge 541748dc). Empty or Remove link takes the
  // link off; a bare domain gets https://; with nothing selected the address
  // goes in as the link's own text, so the button works without a selection.
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const setLink = () => {
    setLinkDraft((editor.getAttributes("link").href as string | undefined) ?? "");
  };
  const unsetLink = () => {
    setLinkDraft(null);
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onChange();
  };
  const applyLink = (raw: string) => {
    const url = raw.trim();
    if (!url) return unsetLink();
    setLinkDraft(null);
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    if (editor.state.selection.empty && !editor.isActive("link")) {
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    onChange();
  };
  return (
    <div
      className={`flex min-h-9 flex-wrap items-center gap-0.5 px-2 py-1 ${
        divider ? "border-b border-[var(--border)]" : ""
      }`}
    >
      <ToolbarButton title={t("editor.bold")} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton title={t("editor.italic")} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton title={t("editor.underline")} active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <span className="underline">U</span>
      </ToolbarButton>
      <span className="mx-1 h-4 w-px bg-[var(--border)]" />
      <ToolbarButton title={t("editor.bulletList")} active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <Ic>
          <line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" />
          <circle cx="4.5" cy="6" r="0.5" fill="currentColor" /><circle cx="4.5" cy="12" r="0.5" fill="currentColor" /><circle cx="4.5" cy="18" r="0.5" fill="currentColor" />
        </Ic>
      </ToolbarButton>
      <ToolbarButton title={t("editor.numberedList")} active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <Ic>
          <line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" />
          <path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
        </Ic>
      </ToolbarButton>
      <span className="mx-1 h-4 w-px bg-[var(--border)]" />
      <ToolbarButton title={t("editor.link")} active={editor.isActive("link")} onClick={setLink}>
        <Ic>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </Ic>
      </ToolbarButton>
      {/* Portaled and fixed, not absolute. This toolbar sits inside
          RemindersView's `email-paper … overflow-hidden` wrapper, which is
          exactly the clipping ancestor AGENTS.md names — so the palette was
          losing its right-hand swatches against the paper's edge. The hook also
          brings the outside-click and Escape handling this had none of. */}
      <>
        <ToolbarButton ref={paletteTrigger} title={t("editor.textColor")} onClick={togglePalette}>
          <Ic>
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
          </Ic>
        </ToolbarButton>
        {paletteOpen &&
          palettePos &&
          createPortal(
          <div
            ref={palettePanel}
            style={{ left: palettePos.left, top: palettePos.top, bottom: palettePos.bottom }}
            className="fixed z-50 flex gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-md"
          >
            {PALETTE.map((c) => (
              <HoverTip key={c} text={c}>
              <button
                type="button"
                aria-label={c}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor.chain().focus().setColor(c).run();
                  closePalette();
                }}
                className="h-4 w-4 rounded-full border border-[var(--border)]"
                style={{ backgroundColor: c }}
              />
              </HoverTip>
            ))}
            <HoverTip text={t("editor.clearColor")}>
            <button
              type="button"
              aria-label={t("editor.clearColor")}
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().unsetColor().run();
                closePalette();
              }}
              className="h-4 w-4 rounded-full border border-[var(--border)] text-[9px] leading-none text-[var(--muted)]"
            >
              ×
            </button>
            </HoverTip>
          </div>,
          document.body,
        )}
      </>
      <ToolbarButton title={t("editor.clearFormatting")} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
        <Ic>
          <path d="M4 7V4h16v3" /><path d="M5 20h6" /><path d="M13 4L8 20" />
          <line x1="15" y1="15" x2="20" y2="20" /><line x1="20" y1="15" x2="15" y2="20" />
        </Ic>
      </ToolbarButton>
      <span className="mx-1 h-4 w-px bg-[var(--border)]" />
      {showVariables && (
        <VariableInsertDropdown compact onInsert={(token) => insertToken(editor, token)} />
      )}
      {/* A drawn face like every tool beside it, not the colour emoji glyph,
          which read as content sitting in the toolbar (Nudge 1f4fafcf). */}
      <EmojiPicker onPick={(emoji) => editor.chain().focus().insertContent(emoji).run()} title={t("editor.insertEmoji")}>
        <Ic>
          <circle cx="12" cy="12" r="10" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <line x1="9" y1="9" x2="9.01" y2="9" />
          <line x1="15" y1="9" x2="15.01" y2="9" />
        </Ic>
      </EmojiPicker>
      {end && <div className="ml-auto flex shrink-0 items-center pl-2">{end}</div>}
      {linkDraft !== null && (
        <InputDialog
          title={t("editor.link")}
          placeholder="https://"
          initialValue={linkDraft}
          extra={linkDraft ? { label: t("editor.removeLink"), onClick: unsetLink } : undefined}
          onSubmit={applyLink}
          onCancel={() => {
            setLinkDraft(null);
            editor.commands.focus();
          }}
        />
      )}
    </div>
  );
}

// What the editor holds, in the form we store: a variable chip back to its
// `[key]` text (lib/emailTokens).
function storedHtml(editor: Editor): string {
  return editor.isEmpty ? "" : htmlToTokens(editor.getHTML());
}

// A `[key]` from the dropdown goes in as a chip, not as text the input rule
// never sees (the rule fires on typing only).
function insertToken(editor: Editor, token: string) {
  const m = /^\[([A-Za-z0-9_]{1,32})\]$/.exec(token);
  editor
    .chain()
    .focus()
    .insertContent(m ? { type: "variableToken", attrs: { key: m[1] } } : token)
    .run();
}

export function EmailBodyEditor({
  value,
  disabled,
  onSave,
  onLiveChange,
  placeholder,
  compact,
  showVariables = true,
  previewPane,
  previewLabel,
}: {
  value: string;
  disabled?: boolean;
  // Called on blur (visual or HTML mode) when the content actually changed.
  onSave: (html: string) => void;
  // Every edit, unsaved — feeds the live preview beside the editor.
  onLiveChange?: (html: string) => void;
  placeholder?: string;
  // The conversation composer's shape: no frame of its own, no Visual/HTML
  // switch, and a body that starts at four lines instead of twelve.
  //
  // The frame goes because the COMPOSER is already a box — one border around
  // subject, body and Send — and a second one nested inside it reads as a
  // field inside a form inside a card. The switch goes because nobody
  // hand-writes HTML in a reply to a customer; it earns its place in the
  // reminder editor, where the thing being written is a template that will go
  // out a thousand times.
  compact?: boolean;
  showVariables?: boolean;
  // A rendered read-only view of this same body, supplied by the parent. When
  // given it becomes a third tab beside Visual and HTML, because it is the
  // same message a third way — not a second panel to place on the page. The
  // editor pane and the preview pane side by side showed the identical
  // formatted text twice and halved the width of the one you type in.
  previewPane?: React.ReactNode;
  previewLabel?: string;
}) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<"visual" | "html" | "preview">("visual");
  // Last value we persisted (or received) — guards no-op saves on blur.
  const savedRef = useRef(value);
  const [htmlDraft, setHtmlDraft] = useState(value);
  const htmlAreaRef = useRef<HTMLTextAreaElement>(null);

  // "@" opens the variable list at the caret (P15), where variables are
  // offered at all (showVariables).
  const variables = useMessageVariables();
  const atVariables = useMemo(
    () => (showVariables ? variables : []),
    [showVariables, variables],
  );
  const [atMenu, setAtMenu] = useState<
    { left: number; top: number; from: number; fragment: string } | null
  >(null);
  const [atActive, setAtActive] = useState(0);
  const atMatches = useMemo(
    () => (atMenu ? matchTokenVariables(atVariables, atMenu.fragment) : []),
    [atMenu, atVariables],
  );
  // handleKeyDown is installed into ProseMirror once and would close over the
  // first render's menu forever, so everything it reads goes through a ref,
  // written in an effect below.
  const atState = useRef<{
    menu: typeof atMenu;
    matches: TokenVariable[];
    active: number;
    accept: (v: TokenVariable) => void;
  }>({ menu: null, matches: [], active: 0, accept: () => {} });
  const atVariablesRef = useRef(atVariables);
  useEffect(() => {
    atVariablesRef.current = atVariables;
  });

  const refreshAt = (e: Editor) => {
    if (atVariablesRef.current.length === 0) return setAtMenu(null);
    const sel = e.state.selection;
    if (!sel.empty) return setAtMenu(null);
    // "\ufffc" for a leaf node keeps one character per position, so the "@"
    // found in the text is at `from - (fragment + 1)` in the document too.
    const before = e.state.doc.textBetween(sel.$from.start(), sel.from, "\n", "\ufffc");
    const hit = atFragment(before);
    if (!hit) return setAtMenu(null);
    const c = e.view.coordsAtPos(sel.from);
    setAtActive(0);
    setAtMenu({
      left: Math.min(Math.max(8, c.left), window.innerWidth - AT_MENU_W - 8),
      top: Math.min(c.bottom + 4, window.innerHeight - 200),
      from: sel.from - (hit.fragment.length + 1),
      fragment: hit.fragment,
    });
  };

  const editor = useEditor({
    // Next.js SSR: render on the client only, avoids hydration mismatch.
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Code formatting has no place in customer emails.
        code: false,
        codeBlock: false,
        // StarterKit v3 bundles link/underline in some configs — keep ours
        // explicit and disable theirs to avoid duplicate registration.
        link: false,
        underline: false,
      }),
      Underline,
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph", "image"] }),
      Image.configure({ inline: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      PreserveEmailAttrs,
      VariableToken,
    ],
    content: tokensToHtml(value || ""),
    onUpdate: ({ editor: e }) => {
      onLiveChange?.(storedHtml(e));
      refreshAt(e);
    },
    onSelectionUpdate: ({ editor: e }) => refreshAt(e),
    onBlur: ({ editor: e }) => {
      setAtMenu(null);
      const html = storedHtml(e);
      if (html !== savedRef.current) {
        savedRef.current = html;
        setHtmlDraft(html);
        onSave(html);
      }
    },
    editorProps: {
      handleKeyDown: (_view, event) => {
        const { menu, matches, active, accept } = atState.current;
        if (!menu || matches.length === 0) return false;
        if (event.key === "ArrowDown") {
          setAtActive((a) => (a + 1) % matches.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setAtActive((a) => (a - 1 + matches.length) % matches.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          accept(matches[active]);
          return true;
        }
        if (event.key === "Escape") {
          // Kept from the sheet the editor sits in: closing the list is all
          // this Escape means.
          event.stopPropagation();
          setAtMenu(null);
          return true;
        }
        return false;
      },
      attributes: {
        class: compact
          ? "email-body-editor focus:outline-none px-1 py-1 text-sm min-h-[4rem] max-h-[14rem] overflow-y-auto"
          : "email-body-editor email-paper rounded-b-md focus:outline-none px-3 py-2 text-sm min-h-[12rem] max-h-[26rem] overflow-y-auto",
      },
    },
  });

  // Sync external value changes (switching to another rule). Baseline savedRef
  // against tiptap's OWN serialization of `value`, not the raw string: tiptap
  // re-serializes HTML (attribute order, self-closing tags) so hand-written
  // input rarely round-trips byte-for-byte, and comparing blur output to the
  // raw input would make a no-op focus+blur look like an edit.
  useEffect(() => {
    if (!editor) {
      savedRef.current = value;
      setHtmlDraft(value);
      return;
    }
    if (storedHtml(editor) !== value) {
      editor.commands.setContent(tokensToHtml(value || ""), { emitUpdate: false });
    }
    savedRef.current = storedHtml(editor);
    setHtmlDraft(value);
  }, [value, editor]);

  // Saves what the editor holds now, for a change that did not come from
  // typing (a dialog, a menu): no blur follows it to do the saving.
  const persistNow = () => {
    if (!editor) return;
    const html = storedHtml(editor);
    if (html === savedRef.current) return;
    savedRef.current = html;
    setHtmlDraft(html);
    onSave(html);
  };

  // Accepting a pick replaces the "@fragment" with the chip.
  const acceptAt = (v: TokenVariable) => {
    const menu = atState.current.menu;
    if (!editor || !menu) return;
    const range = { from: menu.from, to: editor.state.selection.from };
    setAtMenu(null);
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContent({ type: "variableToken", attrs: { key: v.key } })
      .run();
  };
  useEffect(() => {
    atState.current = { menu: atMenu, matches: atMatches, active: atActive, accept: acceptAt };
  });
  const atList = atMenu && (
    <TokenSuggestMenu
      anchor={atMenu}
      matches={atMatches}
      active={atActive}
      onPick={acceptAt}
      onHover={setAtActive}
    />
  );

  const switchMode = (next: "visual" | "html" | "preview") => {
    if (next === mode) return;
    // Preview reads; it never writes. Coming back from it must not re-parse
    // anything, or a round trip through the tab would rewrite the author's
    // HTML with tiptap's re-serialization of it.
    if (next === "preview" || mode === "preview") {
      setMode(next);
      return;
    }
    if (next === "html") {
      // Carry the latest visual content into the textarea.
      if (editor) setHtmlDraft(storedHtml(editor));
    } else if (editor) {
      // Parse the hand-edited HTML back into the visual editor.
      editor.commands.setContent(tokensToHtml(htmlDraft || ""), { emitUpdate: false });
    }
    setMode(next);
  };

  if (compact) {
    return (
      <div className={disabled ? "pointer-events-none opacity-50" : ""}>
        {editor ? (
          <>
            <Toolbar editor={editor} showVariables={showVariables} divider={false} onChange={persistNow} />
            <EditorContent editor={editor} />
            {atList}
          </>
        ) : (
          <div className="min-h-[4rem] animate-pulse" aria-busy="true" />
        )}
      </div>
    );
  }

  // The shared segmented control, as tabs: three views of one body. It was a
  // bordered group with the picked view filled accent, the colour this app
  // keeps for "do something", and the one segmented choice that wore it.
  const modeSwitch = (
    <SegmentedControl
      size="xs"
      semantics="tabs"
      ariaLabel={t("editor.modes")}
      value={mode}
      onChange={switchMode}
      segments={(previewPane
        ? (["visual", "html", "preview"] as const)
        : (["visual", "html"] as const)
      ).map((m) => ({
        id: m,
        label:
          m === "visual"
            ? t("editor.modeVisual")
            : m === "html"
              ? t("editor.modeHtml")
              : (previewLabel ?? t("settings.rulePreview")),
      }))}
    />
  );

  return (
    <div
      className={`rounded-md border border-[var(--border)] bg-[var(--background)] ${
        disabled ? "pointer-events-none opacity-50" : ""
      }`}
    >
      {/* In Visual the switch rides the toolbar's row; HTML and Preview have
          no tools, so the same row holds the switch alone, right-aligned at
          the same height, and switching moves nothing. */}
      {mode !== "visual" && (
        <div className="flex min-h-9 shrink-0 items-center justify-end border-b border-[var(--border)] px-2 py-1">
          {modeSwitch}
        </div>
      )}
      {mode === "preview" ? (
        <div className="p-3">{previewPane}</div>
      ) : mode === "visual" ? (
        editor ? (
          <>
            <Toolbar editor={editor} showVariables={showVariables} onChange={persistNow} end={modeSwitch} />
            <EditorContent editor={editor} />
            {atList}
          </>
        ) : (
          <div className="min-h-[12rem] animate-pulse" aria-busy="true" />
        )
      ) : (
        <textarea
          ref={htmlAreaRef}
          value={htmlDraft}
          rows={12}
          disabled={disabled}
          onChange={(e) => {
            setHtmlDraft(e.target.value);
            onLiveChange?.(e.target.value);
          }}
          onBlur={() => {
            if (htmlDraft !== savedRef.current) {
              savedRef.current = htmlDraft;
              onSave(htmlDraft);
            }
            // Keep the visual editor in sync for the next toggle.
            editor?.commands.setContent(tokensToHtml(htmlDraft || ""), { emitUpdate: false });
          }}
          spellCheck={false}
          className="max-h-[26rem] min-h-[12rem] w-full resize-y bg-transparent px-3 py-2 font-mono text-sm focus:outline-none"
        />
      )}
    </div>
  );
}
