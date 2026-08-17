"use client";

import { useEffect, useRef, useState } from "react";
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
import { VariableInsertDropdown } from "./VariableInsertDropdown";
import { useLanguage } from "@/lib/LanguageProvider";
import { useAnchoredPanel } from "@/lib/useAnchoredPanel";

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
  return (
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
      className={`group relative min-w-6 rounded px-1.5 py-0.5 text-xs leading-5 ${
        active
          ? "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]"
          : "text-[var(--muted)] hover:bg-[var(--muted-bg)] hover:text-[var(--foreground)]"
      }`}
    >
      {children}
      {/* Instant tooltip — native title waits ~1s, too slow to learn icons by. */}
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[var(--foreground)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--background)] group-hover:block">
        {title}
      </span>
    </button>
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

function Toolbar({ editor }: { editor: Editor }) {
  const { t } = useLanguage();
  const {
    triggerRef: paletteTrigger,
    panelRef: palettePanel,
    pos: palettePos,
    open: paletteOpen,
    toggle: togglePalette,
    close: closePalette,
  } = useAnchoredPanel(200, 40);
  const setLink = () => {
    const existing = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt(t("editor.linkPrompt"), existing ?? "https://");
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-[var(--border)] px-2 py-1">
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
              <button
                key={c}
                type="button"
                title={c}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor.chain().focus().setColor(c).run();
                  closePalette();
                }}
                className="h-4 w-4 rounded-full border border-[var(--border)]"
                style={{ backgroundColor: c }}
              />
            ))}
            <button
              type="button"
              title={t("editor.clearColor")}
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().unsetColor().run();
                closePalette();
              }}
              className="h-4 w-4 rounded-full border border-[var(--border)] text-[9px] leading-none text-[var(--muted)]"
            >
              ×
            </button>
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
      <VariableInsertDropdown onInsert={(token) => editor.chain().focus().insertContent(token).run()} />
      <EmojiPicker onPick={(emoji) => editor.chain().focus().insertContent(emoji).run()} title={t("editor.insertEmoji")} />
    </div>
  );
}

export function EmailBodyEditor({
  value,
  disabled,
  onSave,
  onLiveChange,
  placeholder,
}: {
  value: string;
  disabled?: boolean;
  // Called on blur (visual or HTML mode) when the content actually changed.
  onSave: (html: string) => void;
  // Every edit, unsaved — feeds the live preview beside the editor.
  onLiveChange?: (html: string) => void;
  placeholder?: string;
}) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  // Last value we persisted (or received) — guards no-op saves on blur.
  const savedRef = useRef(value);
  const [htmlDraft, setHtmlDraft] = useState(value);
  const htmlAreaRef = useRef<HTMLTextAreaElement>(null);

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
    ],
    content: value || "",
    onUpdate: ({ editor: e }) => {
      onLiveChange?.(e.isEmpty ? "" : e.getHTML());
    },
    onBlur: ({ editor: e }) => {
      const html = e.isEmpty ? "" : e.getHTML();
      if (html !== savedRef.current) {
        savedRef.current = html;
        setHtmlDraft(html);
        onSave(html);
      }
    },
    editorProps: {
      attributes: {
        class:
          "email-body-editor email-paper rounded-b-md focus:outline-none px-3 py-2 text-sm min-h-[12rem] max-h-[26rem] overflow-y-auto",
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
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
    savedRef.current = editor.isEmpty ? "" : editor.getHTML();
    setHtmlDraft(value);
  }, [value, editor]);

  const switchMode = (next: "visual" | "html") => {
    if (next === mode) return;
    if (next === "html") {
      // Carry the latest visual content into the textarea.
      if (editor) setHtmlDraft(editor.isEmpty ? "" : editor.getHTML());
    } else if (editor) {
      // Parse the hand-edited HTML back into the visual editor.
      editor.commands.setContent(htmlDraft || "", { emitUpdate: false });
    }
    setMode(next);
  };

  return (
    <div
      className={`rounded-md border border-[var(--border)] bg-[var(--background)] ${
        disabled ? "pointer-events-none opacity-50" : ""
      }`}
    >
      <div className="flex shrink-0 items-center justify-end border-b border-[var(--border)] bg-[var(--muted-bg)]/50 px-2 py-1">
        <div className="flex overflow-hidden rounded-md border border-[var(--border)] text-xs">
          {(["visual", "html"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`px-2 py-0.5 ${
                mode === m
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {m === "visual" ? "Visual" : "HTML"}
            </button>
          ))}
        </div>
      </div>
      {mode === "visual" ? (
        editor ? (
          <>
            <Toolbar editor={editor} />
            <EditorContent editor={editor} />
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
            editor?.commands.setContent(htmlDraft || "", { emitUpdate: false });
          }}
          spellCheck={false}
          className="max-h-[26rem] min-h-[12rem] w-full resize-y bg-transparent px-3 py-2 font-mono text-sm focus:outline-none"
        />
      )}
    </div>
  );
}
