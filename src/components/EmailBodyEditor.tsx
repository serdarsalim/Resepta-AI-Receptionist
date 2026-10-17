"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
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
import { useLibraryUpload, type LibraryAsset } from "@/lib/useLibraryUpload";

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
  insertPhoto = false,
}: {
  editor: Editor;
  // Gmail's Insert photo: a library image goes INTO the text (P26).
  insertPhoto?: boolean;
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
      {insertPhoto && <InsertPhotoButton editor={editor} onChange={onChange} />}
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

// The address a library image takes inside an email body: relative, on the
// app's own origin, made absolute at send (convex/lib/email
// withAbsoluteEmailImages) and served by the /e/i/ route from the library.
// Never the storage URL: that is a convex.cloud address in a customer's mail,
// which AGENTS.md keeps out of every link we send.
function emailImageSrc(asset: LibraryAsset): string {
  return `/e/i/${asset._id}`;
}

// Gmail's Insert photo (P26, Nudge b4dac12e): the business's library on its
// images, plus an upload tile, in a panel under the button. A pick goes into
// the text at the caret, sized to fit a phone. The same library the WhatsApp
// composer's strip opens, so a photo uploaded here can be sent there too.
function InsertPhotoButton({ editor, onChange }: { editor: Editor; onChange: () => void }) {
  const { t } = useLanguage();
  const { triggerRef, panelRef, pos, open, toggle, close } = useAnchoredPanel(288, 260);
  const assets = useQuery(api.media.list, open ? {} : "skip");
  const touch = useMutation(api.media.touch);
  const library = useLibraryUpload();
  const images = (assets ?? []).filter((a) => a.url && a.contentType.startsWith("image/"));

  const place = (asset: LibraryAsset) => {
    void touch({ assetId: asset._id });
    close();
    editor
      .chain()
      .focus()
      .insertContent({
        type: "image",
        attrs: { src: emailImageSrc(asset), alt: asset.name, style: IMAGE_SIZES.original },
      })
      .run();
    onChange();
  };

  return (
    <>
      <ToolbarButton ref={triggerRef} title={t("editor.insertPhoto")} onClick={toggle}>
        <Ic>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </Ic>
      </ToolbarButton>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
            className="menu-surface fixed z-50 rounded-lg p-2"
          >
            <div className="thin-scroll grid max-h-52 grid-cols-4 gap-1.5 overflow-y-auto">
              {images.map((asset) => (
                <button
                  key={asset._id}
                  type="button"
                  aria-label={asset.name}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => place(asset)}
                  className="aspect-square overflow-hidden rounded-md transition-opacity hover:opacity-80"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.url!} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
              <label
                className={`flex aspect-square cursor-pointer items-center justify-center rounded-md border border-dashed border-[var(--border)] text-sm text-[var(--muted)] transition-colors hover:bg-[var(--muted-bg)] ${
                  library.progress !== null ? "opacity-50" : ""
                }`}
              >
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label={t("editor.uploadPhoto")}
                  disabled={library.progress !== null}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    const asset = await library.upload(file);
                    if (asset && asset.contentType.startsWith("image/")) place(asset);
                  }}
                />
                {library.progress !== null ? "…" : "+"}
              </label>
            </div>
            {assets && images.length === 0 && library.progress === null && !library.error && (
              <p className="pt-2 text-xs text-[var(--muted)]">{t("editor.noPhotos")}</p>
            )}
            {library.error && (
              <p className="pt-2 text-xs text-red-600 dark:text-red-400">{library.error}</p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

// Gmail's image menu (P26, Nudge b4dac12e, 49c31c26): click an image in the
// text and it takes a blue frame, a corner square at each corner to drag it to
// any width (aspect kept), and a row under it: Small | Best fit | Original
// size | Edit alt text | Remove. Sizes are inline styles, the only sizing every
// mail client honours, and each keeps max-width:100% so nothing overflows a
// phone. Portalled and fixed (AGENTS.md: popovers never sit absolute in a
// card), and kept inside the text's own scroller so it never lands on the
// controls below it.
const IMAGE_SIZES = {
  small: "width:200px;max-width:100%;height:auto",
  fit: "width:100%;height:auto",
  original: "max-width:100%;height:auto",
} as const;

function ImageMenu({ editor, onChange }: { editor: Editor; onChange: () => void }) {
  const { t } = useLanguage();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [frame, setFrame] = useState<DOMRect | null>(null);
  const [altDraft, setAltDraft] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const update = () => {
      const sel = editor.state.selection as { node?: { type: { name: string } }; from: number };
      if (!sel.node || sel.node.type.name !== "image" || !editor.isEditable || !editor.isFocused) {
        imgRef.current = null;
        setRect(null);
        return;
      }
      const dom = editor.view.nodeDOM(sel.from);
      const img =
        dom instanceof HTMLImageElement
          ? dom
          : dom instanceof HTMLElement
            ? dom.querySelector("img")
            : null;
      imgRef.current = img;
      setRect(img ? img.getBoundingClientRect() : null);
      let scroller: HTMLElement | null = editor.view.dom;
      while (
        scroller &&
        scroller !== document.body &&
        !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
      ) {
        scroller = scroller.parentElement;
      }
      setFrame(scroller && scroller !== document.body ? scroller.getBoundingClientRect() : null);
    };
    // The selection outlives a click elsewhere on the page; the frame and the
    // row should not, or they float over whatever the person moved on to.
    const hide = () => {
      imgRef.current = null;
      setRect(null);
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    editor.on("focus", update);
    editor.on("blur", hide);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.off("focus", update);
      editor.off("blur", hide);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editor]);

  const setStyle = (style: string) => {
    editor.chain().focus().updateAttributes("image", { style, width: null, height: null }).run();
    onChange();
  };

  // Live on the element while dragging, written to the document once on
  // release, so a drag is one undo step and one save.
  const startResize = (event: React.PointerEvent, fromLeft: boolean) => {
    const img = imgRef.current;
    if (!img) return;
    event.preventDefault();
    const startX = event.clientX;
    const startW = img.getBoundingClientRect().width;
    const maxW = Math.max(40, editor.view.dom.clientWidth - 24);
    let width = startW;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      width = Math.round(Math.max(40, Math.min(maxW, startW + (fromLeft ? -dx : dx))));
      img.style.width = `${width}px`;
      img.style.height = "auto";
      setRect(img.getBoundingClientRect());
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setStyle(`width:${width}px;max-width:100%;height:auto`);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const items: { label: string; run: () => void }[] = [
    { label: t("editor.imageSmall"), run: () => setStyle(IMAGE_SIZES.small) },
    { label: t("editor.imageBestFit"), run: () => setStyle(IMAGE_SIZES.fit) },
    { label: t("editor.imageOriginal"), run: () => setStyle(IMAGE_SIZES.original) },
    {
      label: t("editor.imageAltText"),
      run: () => setAltDraft((editor.getAttributes("image").alt as string | undefined) ?? ""),
    },
    {
      label: t("editor.imageRemove"),
      run: () => {
        editor.chain().focus().deleteSelection().run();
        onChange();
      },
    },
  ];

  const visible = rect && (!frame || (rect.bottom > frame.top && rect.top < frame.bottom));
  const menuTop = rect
    ? Math.max(
        frame?.top ?? 8,
        Math.min(rect.bottom + 6, (frame?.bottom ?? window.innerHeight) - 40),
      )
    : 0;

  return (
    <>
      {visible &&
        rect &&
        createPortal(
          <>
            {(
              [
                [rect.left, rect.top, true, "nwse-resize"],
                [rect.right, rect.top, false, "nesw-resize"],
                [rect.left, rect.bottom, true, "nesw-resize"],
                [rect.right, rect.bottom, false, "nwse-resize"],
              ] as const
            )
              .filter(([, y]) => !frame || (y >= frame.top && y <= frame.bottom))
              .map(([x, y, fromLeft, cursor], i) => (
                <span
                  key={i}
                  aria-hidden
                  onPointerDown={(e) => startResize(e, fromLeft)}
                  style={{ position: "fixed", left: x - 5, top: y - 5, cursor }}
                  className="z-50 h-2.5 w-2.5 touch-none border border-white bg-[#1a73e8]"
                />
              ))}
            <div
              role="toolbar"
              style={{
                position: "fixed",
                top: menuTop,
                left: Math.max(8, Math.min(rect.left, window.innerWidth - 420)),
              }}
              className="menu-surface z-50 flex max-w-[calc(100vw-16px)] flex-wrap items-center rounded-md px-1 py-1 text-sm"
            >
              {items.map((item, i) => (
                <span key={item.label} className="flex items-center">
                  {i > 0 && <span className="h-4 w-px bg-[var(--border)]" aria-hidden />}
                  <button
                    type="button"
                    // mousedown keeps the image selected for the command.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      item.run();
                    }}
                    className="whitespace-nowrap rounded px-2 py-0.5 text-[var(--accent)] hover:bg-[var(--muted-bg)]"
                  >
                    {item.label}
                  </button>
                </span>
              ))}
            </div>
          </>,
          document.body,
        )}
      {altDraft !== null && (
        <InputDialog
          title={t("editor.imageAltText")}
          initialValue={altDraft}
          onSubmit={(alt) => {
            setAltDraft(null);
            editor.chain().focus().updateAttributes("image", { alt: alt.trim() }).run();
            onChange();
          }}
          onCancel={() => setAltDraft(null)}
        />
      )}
    </>
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
  insertPhoto = false,
}: {
  value: string;
  // Gmail's Insert photo on the toolbar: the business's library images, put
  // into the text (P26). For mail to customers only: notes and knowledge
  // have no reader for a picture, and the operator's desk has no library of
  // its own a platform template could safely point at.
  insertPhoto?: boolean;
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
            <Toolbar editor={editor} showVariables={showVariables} divider={false} onChange={persistNow} insertPhoto={insertPhoto} />
            <EditorContent editor={editor} />
            {atList}
            <ImageMenu editor={editor} onChange={persistNow} />
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
            <Toolbar editor={editor} showVariables={showVariables} onChange={persistNow} end={modeSwitch} insertPhoto={insertPhoto} />
            <EditorContent editor={editor} />
            {atList}
            <ImageMenu editor={editor} onChange={persistNow} />
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
